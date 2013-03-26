/*
 * ca-sdc: Cloud Analytics interface to VMAPI and CNAPI
 */

var mod_http = require('http');
var mod_url = require('url');
var mod_ca = require('./ca-common');
var HTTP = require('./http-constants');
var ASSERT = require('assert').ok;

function caSdcError(error)
{
	return (new caError(ECA_REMOTE, null, error));
}

/*
 * Interface for interacting with SDC services that manage the cloud.  'conf'
 * must contain "vmapi_url" and "cnapi_url".
 *
 * We use VMAPI to fetch the VMs (both SmartMachines and KVM machines), but
 * VMAPI knows servers only by server_uuid.  So we must also use CNAPI to
 * translate these back to hostnames.  Since the server_uuid => hostname
 * mappings are immutable and rarely change, we load all servers once at
 * startup, cache results indefinitely, and only load again when VMAPI returns a
 * server_uuid that we don't know about.
 */
function caSdc(conf, log)
{
	ASSERT(conf.cnapi_url);
	this.cam_cnapi = mod_url.parse(conf.cnapi_url);

	ASSERT(conf.vmapi_url);
	this.cam_vmapi = mod_url.parse(conf.vmapi_url);

	this.cam_cache = {};
	this.cam_cache_state = 'ready';
	this.cam_cache_error = undefined;
	this.cam_log = log;
	this.cam_waiting = [];

	this.kick();
}

exports.caSdc = caSdc;

/*
 * Kick off a CNAPI cache refresh and invoke "callback" upon completion.
 * "callback" is invoked with no arguments; the caller is responsible for
 * examining the current state to figure out if the cache is sufficiently up to
 * date for them.  If a refresh is currently pending, this function doesn't
 * execute a new one, but just waits for that one to complete.
 */
caSdc.prototype.kick = function (callback)
{
	var sdc = this;

	if (callback)
		this.cam_waiting.push(callback);

	if (this.cam_cache_state == 'pending')
		return;

	this.cam_log.info('refreshing compute node cache');
	this.cam_cache_state = 'pending';
	this.makeRequest(this.cam_cnapi, 'GET', '/servers', {}, HTTP.OK,
	    function (_, err, servers) {
		ASSERT(sdc.cam_cache_state == 'pending');
		sdc.cam_cache_state = 'ready';

		if (err) {
			sdc.cam_log.error('failed to refresh compute node ' +
			    'cache: %r', err);
			sdc.cam_cache_error = err;
			sdc.wakeup();
			return;
		}

		sdc.cam_cache_error = undefined;
		sdc.cam_log.info('refreshed compute node cache ' +
		    '(%d total servers)', servers.length);
		servers.forEach(function (server) {
			sdc.cam_cache[server['uuid']] = server['hostname'];
		});
		sdc.wakeup();
	    });
};

/*
 * Invoke the callbacks for callers waiting for a CNAPI cache refresh to
 * complete.
 */
caSdc.prototype.wakeup = function ()
{
	var waiters = this.cam_waiting;
	this.cam_waiting = [];
	waiters.forEach(function (callback) { callback(); });
};

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
 *	  limit here, but as we only talk to SDC services, this flaw only allows
 *	  someone who has compromised SDC to disrupt Cloud Analytics, which
 *	  would be the least of our problems.
 *
 * The 'method', 'uri', and 'headers' arguments are the same as those used in
 * node's HTTP client's "request' method.  'code' denotes the expected HTTP
 * status code.  Upon completion, 'callback' will be invoked with three
 * arguments:
 *	code		the actual HTTP status code
 *	error		an Error object, or null if none
 *	value		the decoded JSON value, or null if error
 */
caSdc.prototype.makeRequest = function (url, method, uri, headers, code,
    callback)
{
	var options = {
	    'method': method,
	    'path': uri,
	    'headers': headers,
	    'agent': false,
	    'host': url['host'],
	    'port': url['port']
	};

	var request = mod_http.request(options);
	request.end();
	request.on('error', function (err) { callback(null, err, null); });
	request.on('response', function (response) {
		var error;
		var data = '';
		var rcode = response.statusCode;

		if (rcode != code) {
			error = mod_ca.caSprintf('server returned code ' +
			    '%d but expected %d', rcode, code);
			callback(rcode, caSdcError(error), null);
			return;
		}

		response.on('data', function (chunk) { data += chunk; });

		response.on('end', function () {
			var value;

			try {
				value = JSON.parse(data);
			} catch (ex) {
				error = mod_ca.caSprintf('server returned ' +
				    'invalid JSON: %s', ex.toString());
				callback(rcode, caSdcError(error), null);
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
 * empty object. If any one of the endpoints fails, we return an error.
 */
caSdc.prototype.listContainers = function (customer_id, callback)
{
	var sdc = this;

	this.makeRequest(this.cam_vmapi, 'GET',
	    '/vms?owner_uuid=' + customer_id, {}, HTTP.OK,
	    function (code, err, vms) {
		var i, vm;

		if (!err && !Array.isArray(vms))
			err = caSdcError('server returned unexpected value');

		if (!err) {
			for (i = 0; i < vms.length; i++) {
				vm = vms[i];

				if (vm === null ||
				    typeof (vm) != 'object' ||
				    typeof (vm.uuid) != 'string' ||
				    typeof (vm.server_uuid) != 'string') {
					err = caSdcError(
					    'server returned unexpected value');
					break;
				}
			}
		}

		if (err) {
			callback(err, null);
			return;
		}

		for (i = 0; i < vms.length; i++) {
			vm = vms[i];
			if (!sdc.cam_cache.hasOwnProperty(vm.server_uuid))
				break;
		}

		if (i === vms.length) {
			sdc.listContainersFinish(vms, callback);
		} else {
			sdc.kick(function () {
				sdc.listContainersFinish(vms, callback);
			});
		}
	    });
};

/*
 * Finish a listContainers() request.  At this point, we either know that the
 * compute node cache has everything we need, or we've tried to refresh it.
 * At this point, we make a best effort: if there's at least one VM to return,
 * even if there are other VMs whose servers we were unable to resolve due to an
 * error, we'll return the VMs that we can.  If we can return zero VMs and there
 * was an error, then we'll emit that.
 */
caSdc.prototype.listContainersFinish = function (vms, callback)
{
	var sdc = this;
	var rv = {};

	vms.forEach(function (vm) {
		if (!sdc.cam_cache.hasOwnProperty(vm.server_uuid))
			return;

		var hostname = sdc.cam_cache[vm.server_uuid];
		ASSERT(typeof (hostname) == 'string');

		if (!rv.hasOwnProperty(hostname))
			rv[hostname] = [];

		rv[hostname].push(vm.uuid);
	});

	this.cam_log.info('list vms: %j', rv);

	if (vms.length > 0 && caIsEmpty(rv) &&
	    this.cam_cache_error !== undefined)
		callback(this.cam_cache_error);
	else
		callback(null, rv);
};
