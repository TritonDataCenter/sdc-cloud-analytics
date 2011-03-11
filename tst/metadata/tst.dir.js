/*
 * Tests caMetadataLoadDirectory
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */
var mgr = new mod_md.caMetadataManager(mod_tl.ctStdout);

function normal()
{
	mod_md.caMetadataLoadDirectory('./data/tree/subdir1', 3,
	    function (err, result) {
		ASSERT(!err);
		mod_assert.deepEqual(result, {
			file1: { name: 'martin', likes: 'lute' },
			file2: { name: 'ralph', likes: 'lisa' }
		});
		mod_tl.advance();
	});
}

function nonexistent()
{
	mod_md.caMetadataLoadDirectory('./data/nonexistent', 3,
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
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
