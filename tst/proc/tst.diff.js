/*
 * This test spawns a process, gets its proc data, verifies that it maches what
 * we expect, and that values that should have increased, have.
 */

var mod_assert = require('assert');
var mod_child = require('child_process');
var mod_proc = require('../../lib/ca/ca-proc.js');
var mod_tl = require('../../lib/tst/ca-test');

var g_back, g_pid, g_fdata, g_sdata;
var timeout = 500; /* .5 s */

function createBackend()
{
	g_pid = process.pid;
	mod_proc.caProcLoadCTF(function (err, ctype) {
		if (err) {
			mod_tl.ctStdout.error(caSprintf('failed to load CTF ' +
			    'data: %r', err));
			process.exit(1);
		}

		g_back = new mod_proc.caProcDataCache(ctype, timeout);
		mod_tl.advance();
	});
}

/*
 * Get the proc data
 */
function getData()
{
	g_back.data(function (objs) {
		if (!(g_pid in objs)) {
			mod_tl.ctStdout.error(caSprintf('pid %d missing ' +
			    'from data\n', g_pid));
			process.exit(1);
		}

		if (g_fdata) {
			g_sdata = objs[g_pid];
			mod_tl.advance();
		} else {
			g_fdata = objs[g_pid];
			setTimeout(function () {
				mod_tl.advance();
			}, 2*timeout);
		}
	});
}

/*
 * Verify data about our pid from the proc backend
 */
function verify()
{
	mod_assert.equal(g_pid, g_fdata['pr_pid'],
	    'child pid from first read does not mach execpted value');
	mod_assert.equal(g_pid, g_sdata['pr_pid'],
	    'child pid from second read does not mach execpted value');
	mod_assert.equal(g_fdata['pr_ppid'], g_sdata['pr_ppid'],
	    'parent pids are not equal');
	if (g_sdata['pr_time']['tv_sec'] !== 0) {
		mod_assert.ok(g_sdata['pr_time']['tv_sec'] >=
		    g_fdata['pr_time']['tv_sec']);
		mod_assert.ok(g_sdata['pr_time']['tv_nsec'] >
		    g_fdata['pr_time']['tv_nsec']);
	}
	mod_tl.advance();
}

/*
 * Push functions
 */
/* It shouldn't take more than 10x timeout */
mod_tl.ctSetTimeout(10 * timeout);
mod_tl.ctPushFunc(createBackend);
mod_tl.ctPushFunc(getData);
mod_tl.ctPushFunc(getData);
mod_tl.ctPushFunc(verify);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
