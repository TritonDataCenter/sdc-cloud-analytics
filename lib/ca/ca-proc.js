/*
 * lib/ca/ca-proc.js: /proc-related data cache.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;
var mod_child = require('child_process');
var mod_fs = require('fs');
var mod_ctype = require('ctype');
var mod_native = require('ca-native');

var mod_ca = require('./ca-common');

/*
 * Unfortunately the toString() function on Buffers in node.js don't quite work
 * with ascii strings as one might expect. When there is no end value passed
 * into Buffer.toString(), regardless of encoding, it assumes that the end is
 * always the end of the buffer. When v8 is given an explicit start and length
 * it ends up assuming all those characters are part of the string. This means
 * that if there is a null terminator in the string it is ignored. Given that we
 * are often dealing with traditional C strings where this is the case, this is
 * problematic.
 *
 * This function returns the index of the first zero or the length of the buffer
 * if no '\0' is found.
 */
function caProcBufferEOF(buffer)
{
	var ii;
	for (ii = 0; ii < buffer.length; ii++) {
		if (buffer[ii] === 0)
			return (ii);
	}

	return (ii);
}

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

		ctype = mod_ctype.parseCTF(parse, {
		    'endian': 'little',
		    'char-type': 'uint8'
		});
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
	this.ipdm_zcache = {};
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
 * [private] Translate a zone id to a zone name. As a part of the lookup we
 * cache all the mappings from zone id to zone name. The lifetime of the cache
 * is managed externally to this function. Currently the cache is cleared at the
 * beginning of every refresh.
 *
 * There is a race condition here. We may end up getting the /proc data for a
 * zone while it is shutting down. In that case, we will not be able to get the
 * zone name. We will know this because we get an EINVAL as the errno from the
 * call and it is extremely unlikely that /proc would give us an invalid zone
 * id. Any zone that comes back in this situation will be labelled
 * 'shutting-down'. It is possible for getzonenamebyid to return EFAULT, but
 * only if the node module has messed up. In this case we throw, because this
 * represents a serious error.
 */
caProcDataCache.prototype.zonename = function (zid) {
	if (zid in this.ipdm_zcache)
		return (this.ipdm_zcache[zid]);

	try {
		this.ipdm_zcache[zid] = mod_native.zoneNameById(zid);
	} catch (ex) {
		if (ex.code != 'EINVAL')
			throw (ex);
		this.ipdm_zcache[zid] = 'shutting-down';
	}

	return (this.ipdm_zcache[zid]);
};

/*
 * [private] Read the ctype data from a single pid in /proc.
 *
 * Note the use of an array of arguments in here does look a bit weird. However,
 * this is being done because caRunParallel currently only saves the first two
 * arguments to the callback.
 */
caProcDataCache.prototype.readEntry = function (pid, callback) {
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

		/*
		 * Here we have to fix up a few different pieces of the proc
		 * structures. This basically saves work that every client would
		 * have to do otherwise, so we centralize it. Currently this is
		 * limited to the following changes:
		 *
		 * - pr_zonename is added with the zone name
		 * - pr_fname and pr_psargs are changed into strings
		 * - pr_lwp.pr_clname and pr_lwp.pr_name are translated into
		 * strings
		 */
		parse = parse['psinfo'];
		parse['pr_fname'] = parse['pr_fname'].toString('ascii', 0,
		    caProcBufferEOF(parse['pr_fname']));
		parse['pr_psargs'] = parse['pr_psargs'].toString('ascii', 0,
		    caProcBufferEOF(parse['pr_psargs']));
		parse['pr_lwp']['pr_clname'] = parse['pr_lwp']['pr_clname'].
		    toString('ascii', 0,
		    caProcBufferEOF(parse['pr_lwp']['pr_clname']));
		parse['pr_lwp']['pr_name'] = parse['pr_lwp']['pr_name'].
		    toString('ascii', 0,
		    caProcBufferEOF(parse['pr_lwp']['pr_name']));
		parse['pr_zonename'] = mgr.zonename(parse['pr_zoneid']);
		callback(null, [ pid, parse ]);
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
	mgr.ipdm_zcache = {};

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
