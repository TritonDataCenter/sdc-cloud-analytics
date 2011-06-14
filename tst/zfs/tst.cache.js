/*
 * tst.cache.js: tests caZfsDataCache
 */

var mod_assert = require('assert');
var mod_zfs = require('../../lib/ca/ca-zfs');
var mod_tl = require('../../lib/tst/ca-test');

var cache, cmd_expected, fields_expected, error_returned, data_returned, calls;

function FakeZfsData(cmd, fields, callback)
{
	mod_assert.equal(cmd, cmd_expected);
	mod_assert.deepEqual(fields, fields_expected);
	setTimeout(function () {
		calls++;
		callback(error_returned, data_returned);
	}, 0);
}

function setup()
{
	cmd_expected = 'cazfs';
	cache = new mod_zfs.caZfsDataCache(cmd_expected, FakeZfsData,
	    mod_tl.ctStdout);
	error_returned = null;
	calls = 0;
	mod_tl.advance();
}

function check_columns()
{
	var ocalls = calls;

	fields_expected = [];
	data_returned = { obj1: {}, obj2: {} };
	cache.data(function (data) {
		mod_assert.equal(calls, ocalls + 1);
		mod_assert.deepEqual(data_returned, data);
		mod_tl.advance();
	});
}

function check_columns_multi()
{
	var ocalls = calls;

	cache.column('nelson', true);
	cache.column('kearny', true);
	cache.column('kearny', true);
	cache.column('bart', true);
	cache.column('kearny', false);
	cache.column('bart', false);
	fields_expected = [ 'nelson', 'kearny' ];
	data_returned = { obj1: { nelson: 0, kearny: 1 } };

	cache.data(function (data) {
		mod_assert.equal(calls, ocalls + 1);
		mod_assert.deepEqual(data_returned, data);
		mod_tl.advance();
	});
}

function check_data_cached()
{
	var ocalls = calls;

	cache.data(function (data) {
		mod_assert.equal(calls, ocalls);
		mod_assert.deepEqual(data_returned, data);
		mod_tl.advance();
	});
}

function check_error()
{
	var ocalls = calls;

	cache.column('homer', true); /* clear cache */
	fields_expected = [ 'nelson', 'kearny', 'homer' ];
	error_returned = new caError(ECA_INVAL, null, 'injected error');
	data_returned = null;

	cache.data(function (data) {
		mod_assert.equal(calls, ocalls + 1);
		mod_assert.ok(data === undefined);
		mod_tl.advance();
	});
}

mod_tl.ctPushFunc(setup);
mod_tl.ctPushFunc(check_columns);
mod_tl.ctPushFunc(check_columns_multi);
mod_tl.ctPushFunc(check_data_cached);
mod_tl.ctPushFunc(check_error);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
