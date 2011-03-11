/*
 * Tests caMetadataLoadFile.
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */
var mgr = new mod_md.caMetadataManager(mod_tl.ctStdout);

function normal()
{
	mod_md.caMetadataLoadFile('./data/file1.json', function (err, result) {
		ASSERT(!err);
		mod_assert.deepEqual(result, { name: 'martin', likes: 'lute' });
		mod_tl.advance();
	});
}

function nonexistent()
{
	mod_md.caMetadataLoadFile('./data/nonexistent.json',
	    function (err, result) {
		ASSERT(err);
		mod_tl.ctStdout.dbg('got error (expected): %r', err);
		ASSERT(err instanceof caError);
		ASSERT(!result);
		mod_tl.advance();
	});
}

function badjson()
{
	mod_md.caMetadataLoadFile('./data/invalid.json',
	    function (err, result) {
		ASSERT(err);
		mod_tl.ctStdout.dbg('got error (expected): %r', err);
		ASSERT(err instanceof caError);
		ASSERT(!result);
		mod_tl.advance();
	});
}

mod_tl.ctPushFunc(normal);
mod_tl.ctPushFunc(nonexistent);
mod_tl.ctPushFunc(badjson);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
