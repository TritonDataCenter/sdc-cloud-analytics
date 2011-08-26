/*
 * ca-mapi: Cloud Analytics MAPI interface
 */

var mod_http = require('http');
var mod_ca = require('./ca-common');
var HTTP = require('./http-constants');
var ASSERT = require('assert').ok;

function caMapiError(error)
{
	return (new caError(ECA_REMOTE, null, error));
}

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
			callback(rcode, caMapiError(error), null);
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
				callback(rcode, caMapiError(error), null);
				return;
			}

			callback(rcode, null, value);
		});
	});
};


/*
 * Given a customer id and endpoint fetch the list of containers for this
 * customer grouped by server hostname. Output is formatted per the description
 * in listContainers.
 */
caMapi.prototype.listEndpoint = function (customer_id, endpoint, callback)
{
	var mapi, uri;

	mapi = this;
	uri = '/customers/' + customer_id + '/' + endpoint;
	this.makeRequest('GET', uri, this.cam_headers, HTTP.OK,
	    function (code, err, containers) {
		var ii, error;

		if (code == HTTP.NOCONTENT || code == HTTP.ENOTFOUND) {
			callback(null, {});
			return;
		}

		if (err) {
			callback(err, null);
			return;
		}

		if (containers.constructor !== Array) {
			error = 'server returned unexpected value';
			callback(caMapiError(error), null);
			return;
		}

		for (ii = 0; ii < containers.length; ii++) {
			if (containers[ii].constructor !== Object ||
			    !('server' in containers[ii]) ||
			    containers[ii].server.constructor !== Object) {
				error = 'server returned unexpected value';
				callback(caMapiError(error), null);
				return;
			}
		}
		mapi.processContainers(containers, callback);
	    });
};

/*
 * To merge the multiple endpoints that exist we need to do more than a simple
 * caDeepCopyInto because that would cause us to lose repeated keys. Instead our
 * algorithm does the following depending on whether or not the key in source is
 * in out. The general format of this list looks like:
 *
 * { 'bh1-kvm2': [ 'e64ce3e4-0ae9-46fe-bc7d-f89e54c550de' ] }
 *
 * Each key points to an array of strings. So if the key exists in both the
 * source and the out, then we need to append to the already existent list.
 * Otherwise we can just caDeepCopy it.
 */
function mergeContainerList(out, source) {
	var key, ii;

	for (key in source) {
		if (!(key in out)) {
			out[key] = caDeepCopy(source[key]);
			continue;
		}

		for (ii = 0; ii < source[key].length; ii++)
			out[key].push(source[key][ii]);
	}
}

/*
 * Given a customer id, fetch the list of containers for this customer grouped
 * by server hostname.  The callback is invoked with two arguments when the
 * operation completes: first is an error object (or null if none) and second is
 * an object where keys are server hostnames and values are arrays of string
 * zonenames.  If no customer is found, this operation succeeds and returns an
 * empty object. If any one of the endpoints fails, we return an error.
 *
 * Currently MAPI does not have an endpoint that has both VMs and zones. This is
 * unfortunate, but it's easier for us to work around for now until that work
 * gets done.
 */
caMapi.prototype.listContainers = function (customer_id, callback)
{
	var endpoints, cb, mapi;

	endpoints = [ 'vms', 'containers' ];
	mapi = this;

	cb = function (res) {
		var entry, out, ii, results;

		results = res['results'];
		if (res['nerrors'] !== 0) {
			entry = res['errlocs'][0];
			callback(results[entry]['error']);
			return;
		}

		out = {};
		for (ii = 0; ii < results.length; ii++)
			mergeContainerList(out, results[ii]['result']);

		callback(null, out);
	};

	caRunParallel(endpoints.map(function (end) {
	    return (function (callb) {
	        mapi.listEndpoint(customer_id, end, callb);
	    });
	}), cb);
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
		return (callback(caMapiError(error), null));
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
