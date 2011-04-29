/*
 * tst.stash_bucket.js: test stash bucket operations
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_ca = require('../../lib/ca/ca-common');
var mod_calog = require('../../lib/ca/ca-log');
var mod_capersist = require('../../lib/ca/ca-persist');
var mod_tl = require('../../lib/tst/ca-test');

var stash, tmpdir, log;
var start, middle;
var expected;

mod_tl.ctSetTimeout(10 * 1000);

function setup()
{
	var sysinfo;

	tmpdir = mod_tl.ctTmpdir();
	log = new mod_calog.caLog({ out: process.stderr });
	log.info('using tmpdir "%s"', tmpdir);

	sysinfo = mod_ca.caSysinfo(process.argv[1], '0.0');
	start = new Date().getTime();
	stash = new mod_capersist.caStash(log, sysinfo);
	stash.init(tmpdir, mod_tl.advance);
}

function check_and_fill(err)
{
	var metadata;

	ASSERT(!err, caSprintf('unexpected error: %j', err));
	metadata = stash.bucketMetadata('janey');
	ASSERT(!metadata);

	stash.bucketContents('janey', function (err2, result) {
		ASSERT(err2);
		ASSERT(err2.code() == ECA_NOENT);

		expected = { friend: 'bart', likes: 'milhouse' };
		stash.bucketFill('janey', expected, 'somecontentsomg',
		    mod_tl.advance);
	});
}

function filled(err)
{
	ASSERT(!err, caSprintf('unexpected error: %j', err));
	mod_assert.deepEqual(expected, stash.bucketMetadata('janey'));

	stash.bucketContents('janey', function (err2, result) {
		ASSERT(!err2, caSprintf('unexpected error: %j', err2));
		log.dbg('got back bucket: %j', result);
		mod_assert.deepEqual(expected, result['metadata']);
		mod_assert.equal('somecontentsomg', result['data']);
		mod_tl.advance();
	});
}

function fill_again()
{
	expected = { friend: 'otto' };
	stash.bucketFill('janey', expected, 'morestuff', mod_tl.advance);
}

function check_again(err)
{
	ASSERT(!err, caSprintf('unexpected error: %j', err));
	mod_assert.deepEqual(expected, stash.bucketMetadata('janey'));

	stash.bucketContents('janey', function (err2, result) {
		ASSERT(!err2, caSprintf('unexpected error: %j', err2));
		log.dbg('got back bucket: %j', result);
		mod_assert.deepEqual(expected, result['metadata']);
		mod_assert.equal('morestuff', result['data']);
		mod_tl.advance();
	});
}

function newstash()
{
	stash = new mod_capersist.caStash(log, {});
	middle = new Date().getTime();
	stash.init(tmpdir, mod_tl.advance);
}

function newstash_check(err)
{
	var created;

	ASSERT(!err, caSprintf('unexpected error: %j', err));

	created = stash.created().getTime();
	ASSERT(created >= start);
	ASSERT(created <= middle);

	mod_assert.deepEqual(expected, stash.bucketMetadata('janey'));
	stash.bucketContents('janey', function (err2, result) {
		ASSERT(!err2, caSprintf('unexpected error: %j', err2));
		log.dbg('got back bucket: %j', result);
		mod_assert.deepEqual(expected, result['metadata']);
		mod_assert.equal('morestuff', result['data']);
		mod_tl.advance();
	});
}

function cleanup()
{
	log.info('removing "%s"', tmpdir);
	mod_capersist.caRemoveTree(log, tmpdir, mod_tl.advance);
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check_and_fill);
mod_tl.ctPushFunc(filled);
mod_tl.ctPushFunc(fill_again);
mod_tl.ctPushFunc(check_again);
mod_tl.ctPushFunc(newstash);
mod_tl.ctPushFunc(newstash_check);
mod_tl.ctPushFunc(cleanup);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
