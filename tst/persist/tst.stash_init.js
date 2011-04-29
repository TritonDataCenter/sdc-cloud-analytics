/*
 * tst.stash_init.js: test stash initialization from a non-existent directory
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_calog = require('../../lib/ca/ca-log');
var mod_capersist = require('../../lib/ca/ca-persist');
var mod_tl = require('../../lib/tst/ca-test');

var stash, tmpdir, log;
var start, end;

mod_tl.ctSetTimeout(10 * 1000);

function setup()
{
	var sysinfo;

	tmpdir = mod_tl.ctTmpdir();
	log = new mod_calog.caLog({ out: process.stderr });
	log.info('using tmpdir "%s"', tmpdir);

	sysinfo = mod_ca.caSysinfo(process.argv[1], '0.0');
	stash = new mod_capersist.caStash(log, sysinfo);
	stash.init(tmpdir + '/foo', mod_tl.advance);
}

function check1(err)
{
	/*
	 * That first attempt should fail because the temporary directory
	 * doesn't yet exist.  We'll next try to initialize using the temporary
	 * directory, which should work because its parent does exist.
	 */
	ASSERT(err);
	ASSERT(err.code() == ECA_NOENT);
	log.info('got expected error: %r', err);
	start = new Date().getTime();
	stash.init(tmpdir, mod_tl.advance);
}

function check2(err)
{
	var created;

	ASSERT(!err);
	end = new Date().getTime();
	created = stash.created();

	ASSERT(created >= start);
	ASSERT(created <= end);

	mod_tl.advance();
}

function cleanup()
{
	log.info('removing "%s"', tmpdir);
	mod_capersist.caRemoveTree(log, tmpdir, mod_tl.advance);
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check1);
mod_tl.ctPushFunc(check2);
mod_tl.ctPushFunc(cleanup);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
