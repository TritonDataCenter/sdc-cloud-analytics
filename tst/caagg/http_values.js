/*
 * http_values.js: tests HTTP interface for aggregator
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_cap = require('../../lib/ca/ca-amqp-cap');
var mod_tl = require('../../lib/tst/ca-test');
var HTTP = require('../../lib/ca/http-constants');

mod_tl.ctSetTimeout(50 * 1000);

/*
 * Set up a fake AMQP entity to play the role of config service and
 * instrumenter.  Wait for the aggregator to be online before advancing.
 * Recall that the aggregator is started asynchronously with respect to this
 * process, so there are two possible orders for things to happen:
 *
 * (1) The aggregator comes up and sends its "online" message.  Then we come up.
 *     In this case, we will have missed that message, so we need to send the
 *     "configsvc_online" message to prompt the aggregator to resend its
 *     "online" message.
 *
 * (2) We come up, then the aggregator comes up and sends its "online" message.
 *
 * To handle both cases, we come up, send the "configsvc_online" message, and
 * then wait for the aggregator's "online" message.  This will always work.
 * However, in case (2), we get an extra "aggregator online" message so we must
 * be careful to avoid accidentally advancing the test twice.
 */
var cap, connected, enabled;
var aggport, aggqueue, instnqueue, http;

var instnid = 'global;1';
var time1 = 12340, time2 = 12350;
var value1 = { '8.12.47.107': [[[10, 20], 5], [[30, 40], 3]] };
var value2 = {
    '8.12.47.107': [[[0, 10], 7], [[10, 20], 2]],
    '138.16.60.2': [[[10, 20], 100]]
};

function setup_svcs()
{
	cap = mod_tl.ctCreateCap({
	    host: 'test' + process.pid,
	    type: 'config', /* we also moonlight as an instr */
	    bind: [ mod_cap.ca_amqp_key_all, mod_cap.ca_amqp_key_config ]
	});

	cap.on('msg-notify-aggregator_online', function (msg) {
		if (aggqueue)
			/* We can get this message twice.  See above. */
			return;

		aggqueue = msg.ca_source;
		aggport = msg.ag_http_port;
		http = new mod_tl.ctHttpRequester(aggport);
		mod_tl.advance();
	});

	cap.on('connected', function () {
		mod_assert.ok(!connected);
		connected = true;

		/*
		 * Send the configsvc_online message so we can wait for the
		 * aggonline message to know that the aggregator is up.
		 */
		cap.sendNotifyCfgOnline(mod_cap.ca_amqp_key_all);
	});

	cap.start();
}

/*
 * Send the aggregator an "enable aggregation" message for a fake
 * instrumentation and then start sending data for this instrumentation.
 */
function setup_instn()
{
	instnqueue = aggqueue + '_instn1';

	cap.on('msg-ack-enable_aggregation', function (msg) {
		mod_assert.ok(!enabled);
		enabled = true;
		mod_tl.advance();
	});

	cap.sendCmdEnableAgg(aggqueue, 1, instnid, instnqueue, {
	    'retention-time': 0,
	    'granularity': 10,
	    'transformations': { 'reversedns': true },
	    'value-arity': mod_ca.ca_arity_numeric,
	    'value-dimension': 3,
	    'nsources': 1
	});
}

/*
 * Check the static resources.
 */
function check_static_value()
{
	http.sendEmpty('GET', '/ca/instrumentations/1/value', true,
	    function (err, response, rv) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.deepEqual(rv, [ {
		    name: 'value_raw',
		    uri: '/ca/instrumentations/1/value/raw'
		}, {
		    name: 'value_heatmap',
		    uri: '/ca/instrumentations/1/value/heatmap'
		} ]);

		mod_tl.advance();
	    });
}

function check_static_heatmap()
{
	http.sendEmpty('GET', '/ca/instrumentations/1/value/heatmap', true,
	    function (err, response, rv) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.deepEqual(rv, [ {
		    name: 'image',
		    uri: '/ca/instrumentations/1/value/heatmap/image'
		}, {
		    name: 'details',
		    uri: '/ca/instrumentations/1/value/heatmap/details'
		} ]);

		mod_tl.advance();
	    });
}

/*
 * Send values and wait for them to be processed.
 */
function submit_values()
{
	cap.sendData(aggqueue, instnid, value1, time1 * 1000);
	cap.sendData(aggqueue, instnid, value2, time2 * 1000);
	mod_tl.ctTimedCheck(function (callback) {
		http.sendAsForm('GET', '/ca/instrumentations/1/value/raw',
		    { start_time: time2 + 1, duration: 8 }, false,
			function (err, response, rv) {
			if (err)
				return (callback(err));
			mod_assert.equal(response.statusCode, HTTP.OK);
			if (rv['minreporting'] < 1)
				return (callback(new caError(ECA_REMOTE, null,
				     'minreporting still zero')));
			return (callback(null, rv));
		    });
	}, mod_tl.advance, 3, 1000);
}

/*
 * Checks the common fields in the raw value, including the difference between
 * requested values and actual values.
 */
function check_rawval(orv)
{
	mod_assert.deepEqual(orv, {
	    start_time: time2,			/* normalized by server */
	    duration: 10,			/* normalized by server */
	    requested_start_time: time2 + 1,	/* see above */
	    requested_duration: 8,		/* see above */
	    requested_end_time: time2 + 9,	/* computed from above */
	    value: value2,
	    minreporting: 1,
	    transformations: {},
	    nsources: 1
	});

	/*
	 * Make a request for three data points using ndatapoints=2
	 */
	http.sendAsJson('GET', '/ca/instrumentations/1/value/raw',
	    { start_time: time1 - 9, duration: 10, ndatapoints: 3 }, true,
	    function (err, response, rv) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.deepEqual(rv, [ {
		    start_time: time1 - 10,
		    duration: 10,
		    requested_start_time: time1 - 9,
		    requested_duration: 10,
		    requested_end_time: time1 + 1,
		    value: {},
		    minreporting: 0,
		    transformations: {},
		    nsources: 1
		}, {
		    start_time: time1,
		    duration: 10,
		    requested_start_time: time1 + 1,
		    requested_duration: 10,
		    requested_end_time: time2 + 1,
		    value: value1,
		    minreporting: 1,
		    transformations: {},
		    nsources: 1
		}, {
		    start_time: time2,
		    duration: 10,
		    requested_start_time: time2 + 1,
		    requested_duration: 10,
		    requested_end_time: time2 + 11,
		    value: value2,
		    minreporting: 1,
		    transformations: {},
		    nsources: 1
		} ]);

		mod_tl.advance();
	    });
}

/*
 * Check the error case that we ask for something too far into the future.
 */
function check_future_fail()
{
	var when = Math.floor(new Date().getTime() / 1000) + 10;
	http.sendAsForm('GET', '/ca/instrumentations/1/value/raw',
	    { start_time: when }, true, function (err, response, rv) {
		mod_assert.equal(response.statusCode, HTTP.ECONFLICT);
		mod_assert.deepEqual(rv, {
		    error: {
			code: 'ECA_INVAL',
			message: 'requested data point is too far in the future'
		    }
		});

		mod_tl.advance();
	    });
}

/*
 * Check the okay case where we ask for a data point shortly in the future.
 */
function check_future_ok()
{
	http.sendAsForm('GET', '/ca/instrumentations/1/value/raw',
	    { start_time: time2 + 10, timeout: 2000 }, true,
	    function (err, response, rv) {
		mod_assert.equal(response.statusCode, HTTP.OK);
		mod_assert.ok('delay' in rv);
		mod_assert.ok(parseInt(rv['delay'], 10) == rv['delay']);
		mod_assert.ok(rv['delay'] > 2000);
		mod_assert.ok(rv['delay'] < 3000);
		mod_tl.advance();
	    });
}

/*
 * Test a simple transformation.  We have to try a few times because the server
 * will return without transformation data until it's available.
 */
function check_xforms()
{
	mod_tl.ctTimedCheck(function (callback) {
		http.sendAsForm('GET', '/ca/instrumentations/1/value/raw',
		    { start_time: time2, transformations: [ 'reversedns' ] },
		    true, function (err, response, rv) {
			mod_assert.equal(response.statusCode, HTTP.OK);

			if (Object.keys(
			    rv['transformations']['reversedns']).length < 2)
				return (callback(new caError(ECA_REMOTE, null,
				    'reversedns results not back yet')));

			return (callback(null, rv));
		    });
	}, function (rv) {
		mod_assert.deepEqual(rv, {
		    start_time: time2,
		    duration: 10,
		    requested_start_time: time2,
		    requested_duration: 1,
		    requested_end_time: time2 + 1,
		    value: value2,
		    minreporting: 1,
		    transformations: {
			'reversedns': {
			    '8.12.47.107': [ 'www.joyent.com' ],
			    '138.16.60.2': [ 'techhouse.brown.edu' ]
			}
		    },
		    nsources: 1
		});

		mod_tl.advance();
	}, 10, 1000);
}

var invalid = [
    { start_time: 'foo' },
    { duration: 'foo' },
    { end_time: 'foo' },
    { end_time: -1 },
    { start_time: time1, end_time: time2, duration: time2 - time1 + 1 },
    { transformations: [ 'blahblah' ] },
    { transformations: [ 'geolocate' ] },
    { ndatapoints: 0 }
];

function check_invalid()
{
	var funcs;

	funcs = invalid.map(function (input) {
		return (function (unused, callback) {
			http.sendAsForm('GET',
			    '/ca/instrumentations/1/value/raw', input, true,
			    function (err, response, rv) {
				mod_tl.ctStdout.dbg('input: %j', input);
				mod_assert.equal(response.statusCode,
				    HTTP.ECONFLICT);
				mod_assert.ok('error' in rv);
				mod_assert.ok('code' in rv['error']);
				mod_assert.equal(rv['error']['code'],
				    'ECA_INVAL');
				callback();
			    });
		});
	});

	caRunStages(funcs, null, mod_tl.advance);
}

mod_tl.ctPushFunc(setup_svcs);
mod_tl.ctPushFunc(setup_instn);
mod_tl.ctPushFunc(check_static_value);
mod_tl.ctPushFunc(check_static_heatmap);
mod_tl.ctPushFunc(submit_values);
mod_tl.ctPushFunc(check_rawval);
mod_tl.ctPushFunc(check_future_fail);
mod_tl.ctPushFunc(check_future_ok);
mod_tl.ctPushFunc(check_xforms);
mod_tl.ctPushFunc(check_invalid);
mod_tl.ctPushFunc(mod_tl.ctDoExitSuccess);
mod_tl.advance();
