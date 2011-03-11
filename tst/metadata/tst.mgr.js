/*
 * Tests caMetadataManager
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_tl = require('../../lib/tst/ca-test');
var mod_md = require('../../lib/ca/ca-metadata');

mod_tl.ctSetTimeout(10 * 1000);	/* 10s */
var mgr;

function normal()
{
	mgr = new mod_md.caMetadataManager(mod_tl.ctStdout, './data/tree');
	mgr.load(function (err) {
		ASSERT(!err);
		mod_tl.advance();
	});
}

function check_normal(err)
{
	var types;

	types = mgr.listTypes();
	mod_assert.deepEqual(types.sort(), [ 'subdir1', 'subdir2' ]);
	mod_assert.deepEqual(mgr.list('subdir1').sort(), [ 'file1', 'file2' ]);
	mod_assert.deepEqual(mgr.list('subdir2'), [ 'file3' ]);
	mod_assert.deepEqual(mgr.get('subdir1', 'file1'), {
		name: 'martin', likes: 'lute'
	});
	mod_assert.deepEqual(mgr.get('subdir1', 'file2'), {
		name: 'ralph', likes: 'lisa'
	});
	mod_assert.deepEqual(mgr.get('subdir2', 'file3'), {
		name: 'milhouse', likes: 'lisa'
	});
	mod_tl.advance();
}

function invalid()
{
	mgr = new mod_md.caMetadataManager(mod_tl.ctStdout, './data', 4);
	mgr.load(function (err) {
		ASSERT(err);
		ASSERT(err instanceof caError);
		mod_tl.ctStdout.dbg('got error (expected): %r', err);
		mod_tl.advance();
	});
}

function check_invalid()
{
	var types;

	types = mgr.listTypes();
	mod_assert.deepEqual(types.sort(), [ 'file1', 'tree' ]);
	mod_assert.deepEqual(mgr.list('tree').sort(), [ 'subdir1', 'subdir2' ]);
	mod_assert.deepEqual(mgr.get('tree', 'subdir1'), {
		file1: { name: 'martin', likes: 'lute' },
		file2: { name: 'ralph', likes: 'lisa' }
	});
	mod_assert.deepEqual(mgr.get('tree', 'subdir2'), {
		file3: { name: 'milhouse', likes: 'lisa' }
	});
	mod_tl.advance();
}

mod_tl.ctPushFunc(normal);
mod_tl.ctPushFunc(check_normal);
mod_tl.ctPushFunc(invalid);
mod_tl.ctPushFunc(check_invalid);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
