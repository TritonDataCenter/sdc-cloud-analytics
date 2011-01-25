/*
 * ca-mapi: Cloud Analytics MAPI interface
 */

var mod_http = require('http');
var mod_ca = require('./ca-common');
var HTTP = require('./http-constants');
var ASSERT = require('assert').ok;

/*
 * Interface for interacting with the MAPI service which manages the cloud.
 * 'conf' must contain the following members:
 *
 *	host		hostname / IP address of MAPI instance
 *
 *	port		TCP port for MAPI server
 *
 *	user		username
 *
 *	password	password
 */
function caMapi(conf)
{
	var auth;

	ASSERT(conf.host);
	ASSERT(conf.port);
	this.cam_host = conf.host;
	this.cam_port = conf.port;
	this.cam_user = conf.user;
	this.cam_password = conf.password;

	auth = this.cam_user + ':' + this.cam_password;
	this.cam_headers = {};
	this.cam_headers['Accept'] = 'application/json';
	this.cam_headers['Authorization'] = 'Basic ' +
	    new Buffer(auth).toString('base64');
}

exports.caMapi = caMapi;

/*
 * Makes a simple HTTP request and invokes the specified callback upon
 * completion.  A simple request is one satisfying the following constraints:
 *
 * 	o The request body contains no data.
 *
 *	o On success, the server always returns a single response code.
 *
 *	o The response body represents an object encoded with JSON.
 *
 *	o The response is always sufficiently small that it can be buffered
 *	  completely.  This is implied by the third constraint (since JSON can't
 *	  be parsed in pieces), but it's important to note that we assume this
 *	  independently.  This mechanism could be improved by imposing a size
 *	  limit here, but as we only talk to MAPI, this flaw only allows someone
 *	  who has compromised MAPI to disrupt Cloud Analytics, which would be
 *	  the least of our problems.
 *
 * The 'method', 'uri', and 'headers' arguments are the same as those used in
 * node's HTTP client's "request' method.  'code' denotes the expected HTTP
 * status code.  Upon completion, 'callback' will be invoked with three
 * arguments:
 *	code		the actual HTTP status code
 *	error		an Error object, or null if none
 *	value		the decoded JSON value, or null if error
 */
caMapi.prototype.makeRequest = function (method, uri, headers, code, callback)
{
	var client, request;

	client = mod_http.createClient(this.cam_port, this.cam_host);
	client.on('error', function (err) {
		callback(null, err, null);
	});
	request = client.request(method, uri, headers);
	request.end();
	request.on('response', function (response) {
		var error;
		var data = '';
		var rcode = response.statusCode;

		if (rcode != code) {
			error = mod_ca.caSprintf('server returned code ' +
			    '%d but expected %d', rcode, code);
			callback(rcode, new Error(error), null);
			return;
		}

		response.on('data', function (chunk) {
			data += chunk;
		});

		response.on('end', function () {
			var value;

			try {
				value = JSON.parse(data);
			} catch (ex) {
				error = mod_ca.caSprintf('server returned ' +
				    'invalid JSON: %s', ex.toString());
				callback(rcode, new Error(error), null);
				return;
			}

			callback(rcode, null, value);
		});
	});
};

/*
 * Given a customer id, fetch the list of containers for this customer grouped
 * by server hostname.  The callback is invoked with two arguments when the
 * operation completes: first is an error object (or null if none) and second is
 * an object where keys are server hostnames and values are arrays of string
 * zonenames.  If no customer is found, this operation succeeds and returns an
 * empty object.
 */
caMapi.prototype.listContainers = function (customer_id, callback)
{
	var mapi, uri, done;

	mapi = this;
	uri = '/customers/' + customer_id + '/containers';
	this.makeRequest('GET', uri, this.cam_headers, HTTP.OK,
	    function (code, err, containers) {
		var ii, results, error;

		if (code == HTTP.ENOTFOUND) {
			callback(null, {});
			return;
		}

		if (err) {
			callback(err, null);
			return;
		}

		if (containers.constructor !== Array) {
			error = 'server returned unexpected value';
			callback(new Error(error), null);
			return;
		}

		done = 0;
		results = [];
		for (ii = 0; ii < containers.length; ii++) {
			if (containers[ii].constructor !== Object ||
			    !('uri' in containers[ii]) ||
			    containers[ii].uri.constructor !== String) {
				error = 'server returned unexpected value';
				callback(new Error(error), null);
				return;
			}

			uri = containers[ii]['uri'];
			mapi.makeRequest('GET', uri, mapi.cam_headers, HTTP.OK,
			    function (scode, serr, container) {
				if (serr && scode != HTTP.ENOTFOUND) {
					callback(serr, null);
					return;
				}

				done++;
				if (scode != HTTP.ENOTFOUND)
					results.push(container);

				if (containers.length !== done)
					return;

				mapi.processContainers(results, callback);
			    });
		}
	    });
};

/*
 * Invoked after we've listed the containers and fetched the additional details
 * about each one.  We go through the details, construct the return value, and
 * invoke the callback.
 */
caMapi.prototype.processContainers = function (containers, callback)
{
	var rv, ii, zone;
	var hostname, zonename;
	var fail = function (error) {
		return (callback(new Error(error), null));
	};

	rv = {};
	for (ii = 0; ii < containers.length; ii++) {
		zone = containers[ii];
		if (!zone['server'] || zone['server'].constructor !== Object)
			return (fail('response had no server'));

		hostname = zone['server']['hostname'];
		if (!hostname || hostname.constructor !== String)
			return (fail('server had no string hostname'));

		zonename = zone['name'];
		if (!zonename || zonename.constructor !== String)
			return (fail('server had no string zonename'));

		if (!(hostname in rv))
			rv[hostname] = [];

		rv[hostname].push(zonename);
	}

	return (callback(null, rv));
};
