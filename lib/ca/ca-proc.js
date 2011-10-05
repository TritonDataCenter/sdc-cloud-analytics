/*
 * lib/ca/ca-proc.js: /proc-related data cache.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;
var mod_child = require('child_process');
var mod_fs = require('fs');
var mod_ctype = require('ctype');

var mod_ca = require('./ca-common');

/*
 * We need to get the JSON payload that properly describes the types we care
 * about from ctf2json. This is complicated by the fact that we have different
 * versions of this data for either 32-bit or 64-bit operation. Currently, we
 * only support 32-bit operation and the CA tests for this basically catch this
 * fact. Further, we only assume that we're on x86 and assert that to be the
 * case.
 *
 * This function returns the ctype parser associated with the proper ctf data in
 * the callback.
 */
function caProcLoadCTF(callback)
{
	var stderr, stdout, child, lib, type, prog;
	var sysinfo = mod_ca.caSysinfo();

	mod_assert.ok(sysinfo['ca_os_machine'] == 'i86pc',
	    'CA only runs on x86 machines');
	lib = '/lib/libc.so';
	type = 'psinfo_t';
	prog = 'ctf2json';
	stdout = '';
	stderr = '';

	child = mod_child.spawn(prog, [ '-f', lib, '-t', type ]);
	child.stdout.on('data', function (data) {
	    stdout += data.toString();
	});

	child.stderr.on('data', function (data) {
	    stderr += data.toString();
	});

	child.on('exit', function (code) {
		var ctype, parse;
		if (code !== 0) {
			callback(new caError(ECA_UNKNOWN, null,
			    'failed to run ctf2json (stderr): ' + stderr));
			return;
		}

		try {
			parse = JSON.parse(stdout);
		} catch (ex) {
			callback(new caError(ECA_UNKNOWN, ex,
			    'got invalid json from ctf2json'));
			return;
		}

		ctype = mod_ctype.parseCTF(parse, { endian: 'little' });
		callback(null, ctype);
		return;
	});
}

/*
 * Creates a new CA cache backend. The timeout value is in milliseconds.
 */
function caProcDataCache(ctype, timeout, log)
{
	ASSERT(ctype);
	this.ipdm_last = 0;
	this.ipdm_refreshing = false;
	this.ipdm_data = {};
	this.ipdm_ctype = ctype;
	this.ipdm_callbacks = [];
	this.ipdm_stale_timeout = timeout;
	this.ipdm_log = log;
}

/*
 * Asynchronously retrieve the current data. The callback will return undefined
 * if no data is available or the basic data.
 */
caProcDataCache.prototype.data = function (callback) {
	var mgr, now;

	mgr = this;
	now = new Date().getTime();

	if (now - this.ipdm_last < this.ipdm_stale_timeout) {
		callback(caDeepCopy(this.ipdm_data));
		return;
	}

	mgr.ipdm_callbacks.push(function (error) {
		if (error) {
			callback(undefined);
			return;
		}

		callback(caDeepCopy(mgr.ipdm_data));
		return;
	});

	if (!mgr.ipdm_refreshing)
		mgr.refresh();
};

/*
 * [private] Read the ctype data from a single pid in /proc.
 *
 * Note the use of an array of arguments in here does look a bit weird. However,
 * this is being done because caRunParallel currently only saves the first two
 * arguments to the callback.
 */
caProcDataCache.prototype.readEntry = function (pid, callback)
{
	var path, mgr;

	mgr = this;
	path = caSprintf('/proc/%d/psinfo', pid);
	mod_fs.readFile(path, function (err, buf) {
		var parse;

		if (err) {
			callback(new caSystemError(err));
			return;
		}

		parse = mgr.ipdm_ctype.readData([
		    { psinfo: { type: 'psinfo_t' } } ],
		    buf, 0);
		callback(null, [ pid, parse['psinfo'] ]);
	});
};


/*
 * [private] Go through and fetch data from /proc, return a json object with all
 * the necessary data.
 *
 * This function makes a best effort attempt to read all of the psinfo entries
 * in /proc. The general flow is to do a readdir of /proc and then process each
 * entry from the readdir call. Note that this pattern is different than one
 * might use in C because of how node's readdir works -- it returns an array of
 * all the entries in the directory aside from '.' and '..' entries. A side
 * effect of this is that entries from readdir may no longer exist and an entry
 * may come in while we've been waiting. These entries will not be included in
 * the results.
 *
 * This function will only return an error on two conditions:
 *
 *  - The initial readdir call fails.
 *  - We fail to read _every_ entry in /proc.
 *
 * The data will be returned as a JS Object. Each key will be a pid. Each value
 * will be the node-ctype parsed values of /proc/<pid>/psinfo.
 */
caProcDataCache.prototype.readProc = function (callback) {
	var mgr = this;

	mod_fs.readdir('/proc', function (err, files) {
		var funcs;

		if (err) {
			callback(new caSystemError(err));
			return;
		}

		funcs = files.map(function (pid) {
			return (function (cb) {
				mgr.readEntry(pid, cb);
			});
		});

		caRunParallel(funcs, function (res) {
			var out, ii, entry, errloc;

			if (res['nerrors'] === files.length) {
				errloc = res['errlocs'][0];
				callback(res['results'][errloc]['error']);
				return;
			}

			out = {};
			for (ii = 0; ii < res['results'].length; ii++) {
				entry = res['results'][ii];
				if ('err' in entry)
					continue;

				ASSERT(!(entry['result'][0] in out));
				out[entry['result'][0]] = entry['result'][1];
			}

			callback(null, out);
		});
	});
};

/*
 * [private] Trigger a refresh of our data cache by reading data from /proc
 * again. Invokes each of this.ipdm_callbacks() on completion.
 *
 * It is illegal to invoke this command while another refresh() is ongoing.
 * This may seem overly restrictive, but for a full treatise on the problems
 * with this, see the refresh function in ca-zfs.js.
 */
caProcDataCache.prototype.refresh = function () {
	var mgr, when, callbacks;

	mod_assert.ok(!this.ipdm_refreshing, 'concurrent refresh is illegal');

	mgr = this;
	mgr.ipdm_refreshing = true;
	when = new Date().getTime();

	mgr.readProc(function (error, objects) {
		mgr.ipdm_refreshing = false;
		callbacks = mgr.ipdm_callbacks;
		mgr.ipdm_callbacks = [];

		if (error) {
			mgr.ipdm_log.error('proc: failed to refresh: %r',
			    error);
			callbacks.forEach(function (cb) {
			    cb(error);
			});
			return;
		}

		mgr.ipdm_data = objects;
		mgr.ipdm_last = when;
		callbacks.forEach(function (cb) { cb(); });
		return;
	});
};

exports.caProcLoadCTF = caProcLoadCTF;
exports.caProcDataCache = caProcDataCache;
