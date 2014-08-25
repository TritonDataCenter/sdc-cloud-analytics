/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

/*
 * tst.svc_basic.js: tests bringing up the stash service and interacting with it
 */

var mod_assert = require('assert');
var ASSERT = mod_assert.ok;

var mod_casvc = require('../../lib/ca/ca-svc-stash');
var mod_tl = require('../../lib/tst/ca-test');
mod_tl.ctSetTimeout(30 * 1000);	/* 30s */

var tmpdir, svc, svckey, cap, connected;

function setup_svc()
{
	tmpdir = mod_tl.ctTmpdir();
	svc = new mod_casvc.caStashService([ tmpdir ]);
	svckey = svc.routekey();
	svc.start(mod_tl.advance);
}

function setup_client()
{
	cap = mod_tl.ctCreateCap({ type: 'test', bind: [] });

	cap.on('connected', function () {
		ASSERT(!connected);
		connected = true;
		mod_tl.advance();
	});

	cap.start();
}

function check_noerr(err)
{
	if (err)
		mod_tl.ctStdout.error('unexpected error: %r', err);
	ASSERT(!err);
	mod_tl.advance();
}

function check_contents_empty()
{
	cap.cmdDataGet(svckey, 1000, [ { bucket: '.contents' } ],
	    function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		mod_assert.equal(results[0]['result']['bucket'], '.contents');
		mod_assert.deepEqual(JSON.parse(results[0]['result']['data']),
		    {});
		mod_tl.advance();
	    });
}

function check_nonexistent()
{
	cap.cmdDataGet(svckey, 1000, [
	    { bucket: 'bucket1' }, { bucket: 'bucket2' }, { bucket: 'bucket3' }
	], function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 3);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_NOENT);
		ASSERT('error' in results[1]);
		mod_assert.equal(results[1]['error']['code'], ECA_NOENT);
		ASSERT('error' in results[2]);
		mod_assert.equal(results[2]['error']['code'], ECA_NOENT);
		mod_tl.advance();
	});
}

function fill_buckets()
{
	cap.cmdDataPut(svckey, 1000, [
	    { bucket: 'bucket1', metadata: { mymeta: 'meta1', value: 4 },
		data: 'ask a scientician' },
	    { bucket: 'bucket3', metadata: {},
		data: 'dont let the name fool you' }
	], function (err, results) {
		ASSERT(!err);
		ASSERT(results.length === 2);
		ASSERT(!('error' in results[0]));
		ASSERT(!('error' in results[1]));
		mod_tl.advance();
	});
}

function check_contents_full()
{
	cap.cmdDataGet(svckey, 1000, [ { bucket: '.contents' } ],
	    function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		mod_assert.equal(results[0]['result']['bucket'], '.contents');
		mod_assert.deepEqual(JSON.parse(results[0]['result']['data']), {
			bucket1: { mymeta: 'meta1', value: 4 },
			bucket3: { }
		    });
		mod_tl.advance();
	    });
}

function check_buckets()
{
	cap.cmdDataGet(svckey, 1000, [
	    { bucket: 'bucket1' }, { bucket: 'bucket2' }, { bucket: 'bucket3' }
	], function (err, results) {
		mod_assert.equal(results.length, 3);

		ASSERT(!('error' in results[0]));
		mod_assert.deepEqual(results[0]['result'], {
			bucket: 'bucket1',
			metadata: { mymeta: 'meta1', value: 4 },
			data: 'ask a scientician'
		});

		ASSERT('error' in results[1]);
		mod_assert.equal(results[1]['error']['code'], ECA_NOENT);

		ASSERT(!('error' in results[2]));
		mod_assert.deepEqual(results[2]['result'], {
			bucket: 'bucket3',
			metadata: {},
			data: 'dont let the name fool you'
		});
		mod_tl.advance();
	});
}

function fill_invalid()
{
	cap.cmdDataPut(svckey, 1000, [
	    { bucket: '.reserved', metadata: {},
		data: 'its not really a floor' }
	], function (err, results) {
		ASSERT(!err);
		mod_assert.equal(1, results.length);
		ASSERT('error' in results[0]);
		ASSERT(results[0]['error']['code'] == ECA_INVAL);
		mod_tl.advance();
	});
}

function fill_empty()
{
	cap.cmdDataPut(svckey, 1000, [], function (err, results) {
		ASSERT(!err);
		ASSERT(results.length === 0);
		mod_tl.advance();
	});
}

function check_empty()
{
	cap.cmdDataGet(svckey, 1000, [], function (err, results) {
		ASSERT(!err);
		ASSERT(results.length === 0);
		mod_tl.advance();
	});
}

function fill_bad_bucketname()
{
	cap.cmdDataPut(svckey, 1000, [ {
		bucket: { 'bucket': 1 }, metadata: {}, data: ''
	} ], function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_INVAL);
		mod_tl.advance();
	});
}

function delete_bad_bucketname()
{
	cap.cmdDataPut(svckey, 1000, [ { bucket: { 'bucket': '.contents' } } ],
	    function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_INVAL);
		mod_tl.advance();
	});
}

function fill_bad_metadata()
{
	cap.cmdDataPut(svckey, 1000, [ {
		bucket: 'bucket1', metadata: 15, data: ''
	} ], function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_INVAL);
		mod_tl.advance();
	});
}

function fill_missing_bucketname()
{
	cap.cmdDataPut(svckey, 1000, [ { metadata: {}, data: '' } ],
	    function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_INVAL);
		mod_tl.advance();
	});
}

function fill_missing_metadata()
{
	cap.cmdDataPut(svckey, 1000, [ { bucket: 'bucket1', data: '' } ],
	    function (err, results) {
		ASSERT(!err);
		mod_assert.equal(results.length, 1);
		ASSERT('error' in results[0]);
		mod_assert.equal(results[0]['error']['code'], ECA_INVAL);
		mod_tl.advance();
	});
}

function teardown()
{
	svc.stop(function () {
		ASSERT(connected);
		mod_tl.advance();
	});
}

function check_down()
{
	cap.cmdDataGet(svckey, 3000, [ { bucket: 'bucket1' } ],
	    function (err, result) {
		ASSERT(err);
		ASSERT(err.code() == ECA_TIMEDOUT);
		mod_tl.advance();
	    });
}

function delete_nonexistent()
{
	cap.cmdDataDelete(svckey, 1000, [ { bucket: 'foobar' } ],
	    function (err, results) {
		ASSERT(!err);
		ASSERT('result' in results[0]);
		mod_tl.advance();
	    });
}

function delete_bucket()
{
	cap.cmdDataDelete(svckey, 1000, [ { bucket: 'bucket1' } ],
	    function (err, results) {
		ASSERT(!err);
		ASSERT('result' in results[0]);
		mod_tl.advance();
	    });
}

function check_deleted()
{
	cap.cmdDataGet(svckey, 1000, [
	    { bucket: 'bucket1' }, { bucket: 'bucket2' }, { bucket: 'bucket3' }
	], function (err, results) {
		mod_assert.equal(results.length, 3);

		ASSERT('error' in results[0]);
		mod_assert.equal(results[1]['error']['code'], ECA_NOENT);

		ASSERT('error' in results[1]);
		mod_assert.equal(results[1]['error']['code'], ECA_NOENT);

		ASSERT(!('error' in results[2]));
		mod_assert.deepEqual(results[2]['result'], {
			bucket: 'bucket3',
			metadata: {},
			data: 'dont let the name fool you'
		});
		mod_tl.advance();
	});
}

/* setup */
mod_tl.ctPushFunc(setup_svc);
mod_tl.ctPushFunc(check_noerr);
mod_tl.ctPushFunc(setup_client);
mod_tl.ctPushFunc(check_noerr);

/* starting state, basic input/output */
mod_tl.ctPushFunc(check_contents_empty);
mod_tl.ctPushFunc(check_nonexistent);
mod_tl.ctPushFunc(fill_buckets);
mod_tl.ctPushFunc(check_buckets);
mod_tl.ctPushFunc(check_contents_full);

/* invalid input/output */
mod_tl.ctPushFunc(fill_invalid);
mod_tl.ctPushFunc(fill_empty);
mod_tl.ctPushFunc(check_empty);
mod_tl.ctPushFunc(fill_bad_bucketname);
mod_tl.ctPushFunc(fill_bad_metadata);
mod_tl.ctPushFunc(fill_missing_bucketname);
mod_tl.ctPushFunc(fill_missing_metadata);
mod_tl.ctPushFunc(delete_bad_bucketname);

/* teardown and read data again (durability) */
mod_tl.ctPushFunc(teardown);
mod_tl.ctPushFunc(check_down);

mod_tl.ctPushFunc(setup_svc);
mod_tl.ctPushFunc(check_noerr);
mod_tl.ctPushFunc(check_buckets);

/* bucket delete */
mod_tl.ctPushFunc(delete_nonexistent);
mod_tl.ctPushFunc(delete_bucket);
mod_tl.ctPushFunc(check_deleted);
mod_tl.ctPushFunc(teardown);
mod_tl.ctPushFunc(check_down);
mod_tl.ctPushFunc(setup_svc);
mod_tl.ctPushFunc(check_noerr);
mod_tl.ctPushFunc(check_deleted);

mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
