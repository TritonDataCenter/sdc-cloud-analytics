/*
 * Here we are testing our ability to get metrics.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');

/*
 * Create a fake instrumentor and the modules it supports
 */

var modsA = [ {
    cam_name: 'cpu',
    cam_description: 'CPU',
    cam_stats: [ {
	cas_name: 'utilization',
	cas_fields: [],
	cas_description: 'utilization',
	cas_type: 'percent'
    } ]
} ];

var modsB = [ {
    cam_name: 'io',
    cam_description: 'Disk I/O',
    cam_stats: [ {
	cas_name: 'bytes',
	cas_fields: [ {
	    caf_name: 'hostname',
	    caf_description: 'hostname',
	    caf_string: 'string'
	} ],
	cas_description: 'bytes',
	cas_type: 'size'
    } ]
} ];

var modExp = {
	cpu: {
		label: 'CPU',
		stats: {
			utilization: {
				label: 'utilization',
				type: 'percent',
				fields: {}
			}
		}
	},

	io: {
		label: 'Disk I/O',
		stats: {
			bytes: {
				label: 'bytes',
				type: 'size',
				fields: { hostname: { label: 'hostname' } }
			}
		}
	}
};

var fakeInstA = mod_tl.ctCreateCap({
	host: 'inst-a',
	type: 'instrumenter',
	bind: [ mod_ca.ca_amqp_key_all ]
});

var fakeInstB = mod_tl.ctCreateCap({
	host: 'inst-b',
	type: 'instrumenter',
	bind: [ mod_ca.ca_amqp_key_all ]
});

/*
 * Functions for the state machine
 */
var setup = function ()
{
	mod_tl.ctWaitForAmqpService(mod_ca.ca_amqp_key_config, mod_tl.advance);
};

var startInstA = function ()
{
	fakeInstA.cap_amqp.start(function () {
		mod_tl.ctStdout.info('Called inst online');
		fakeInstA.sendNotifyInstOnline(mod_ca.ca_amqp_key_config,
		    modsA);
		mod_tl.ctStdout.info('Advancing after notifying A is online');
		mod_tl.advance();
	});
};

var startInstB = function ()
{
	fakeInstB.cap_amqp.start(function () {
		mod_tl.ctStdout.info('Called inst online');
		fakeInstB.sendNotifyInstOnline(mod_ca.ca_amqp_key_config,
		    modsB);
		mod_tl.ctStdout.info('Advancing after notifying B is online');
		mod_tl.advance();
	});
};

/*
 * Verify that we can get the list of metrics we expect
 */
var checkMetrics = function ()
{
	var func = function (resFunc) {
	    var url = '/ca/metrics?profile=none';
	    mod_tl.ctHttpRequest({
		method: 'GET',
		path: url,
		port: mod_ca.ca_http_port_config
	    }, function (err, response, data) {
		if (err) {
			resFunc(err);
			return;
		}

		mod_assert.equal(response.statusCode, 200,
			'bad HTTP status: ' + response.statusCode);
		var resp = JSON.parse(data);

		try {
			mod_assert.deepEqual(resp, modExp,
			    mod_ca.caSprintf('Wrong metrics: expected %j ' +
				'got %j', modExp, resp));
		} catch (ex) {
			resFunc(ex);
			return;
		}

		resFunc(null, 0);
	    });
	};

	var suc = function () { process.exit(0); };

	mod_tl.ctTimedCheck(func, suc, 10, 500);
};

/*
 * Push everything and start the test!
 */
mod_tl.ctSetTimeout(10 * 1000);
mod_tl.ctPushFunc(setup, startInstA, startInstB, checkMetrics);
mod_tl.ctStdout.info('Advancing to start the test');
mod_tl.advance();
