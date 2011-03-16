/*
 * Here we are testing the ability to create and destroy instrumentations. Note
 * that here the instrumentors are effectively auto-ackers, as long as the id is
 * valid.
 */

var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_tl = require('../../lib/tst/ca-test');
var CFG_PORT = mod_ca.ca_http_port_config;
var fakeInst, fakeAgg;

/*
 * A wrapper that we use when we get a request to enable instrumentation
 */
var enableInst = function (msg)
{
	if (msg.is_module != 'cpu' || msg.is_stat != 'utilization') {
		mod_tl.ctStdout.error(mod_ca.caSprintf(
		    'Invalid module/stat type: %s/%s',
		    msg.is_module, msg.is_stat));
		fakeInst.sendCmdAckEnableInstFail(msg.ca_source,
		    msg.ca_id, 'invalid module/stat');
	}

	fakeInst.sendCmdAckEnableInstSuc(msg.ca_source, msg.ca_id,
	    msg.is_inst_id);
};

var disableInst = function (msg)
{
	fakeAgg.sendCmdAckDisableAggSuc(msg.ca_source, msg.ca_id,
	    msg.ag_inst_id);
};

/*
 * Always return success
 */
var enableAgg = function (msg)
{
	fakeAgg.sendCmdAckEnableAggSuc(msg.ca_source, msg.ca_id,
	    msg.ag_inst_id);
};

/*
 * Create a fake instrumentor and the modules it supports
 */

var mods = [ {
    cam_name: 'cpu',
    cam_description: 'CPU',
    cam_stats: [ {
	cas_name: 'utilization',
	cas_fields: [],
	cas_description: 'utilization',
	cas_type: 'percent'
    } ]
}, {
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

fakeInst = mod_tl.ctCreateCap({
	host: 'inst',
	type: 'instrumenter',
	bind: [ mod_ca.ca_amqp_key_all ]
});

fakeInst.on('msg-cmd-enable_instrumentation', enableInst);

fakeAgg = mod_tl.ctCreateCap({
	host: 'agg',
	type: 'aggregator',
	bind: [ mod_ca.ca_amqp_key_all ]
});
fakeAgg.on('msg-cmd-enable_aggregation', enableAgg);

var setup = function ()
{
	mod_tl.ctWaitForAmqpService(mod_ca.ca_amqp_key_config, mod_tl.advance);
};

/*
 * Start the aggregator and start the instrumenter from inside it
 */
var startWorld = function ()
{
	fakeAgg.cap_amqp.start(function () {
		mod_tl.ctStdout.info('Called agg online');
		fakeAgg.sendNotifyAggOnline(mod_ca.ca_amqp_key_config,
		    mod_ca.ca_http_port_agg_base, {});
		fakeInst.cap_amqp.start(function () {
			mod_tl.ctStdout.info('Called inst online');
			fakeInst.sendNotifyInstOnline(mod_ca.ca_amqp_key_config,
			    mods);
			mod_tl.ctStdout.info('Advancing notifying online');
			setTimeout(mod_tl.advance, 1000);
		});
	});
};

var createInsts = function ()
{
	var postdata = 'module=cpu&stat=utilization&profile=none';
	var headers = {};
	headers['content-length'] = postdata.length;
	headers['content-type'] = 'application/x-www-form-urlencoded';
	mod_tl.ctHttpRequest({
	    method: 'POST',
	    path: '/ca/instrumentations',
	    port: CFG_PORT,
	    data: postdata,
	    headers: headers
	}, function (err, response, data) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, 201,
		    'bad HTTP status: ' + response.statusCode);
		var resp = JSON.parse(data);
		mod_tl.ctStdout.info('Advancing from createInsts');
		mod_tl.advance(resp.uri.substring(
		    resp.uri.lastIndexOf('/') + 1));
	});
};

var listInsts = function (id, inputExp)
{
	var exp = [ {
	    module: 'cpu',
	    stat: 'utilization',
	    decomposition: [],
	    predicate: {},
	    'value-dimension': 1,
	    'value-arity': 'scalar',
	    enabled: true,
	    'retention-time': 600,
	    'idle-max': 3600,
	    uri: '/ca/instrumentations/1',
	    uris: [ {
		name: 'value_raw',
		uri: '/ca/instrumentations/1/value/raw'
	    } ],
	    transformations: {}
	}];

	if (inputExp)
		exp = inputExp;

	mod_tl.ctHttpRequest({
	    method: 'GET',
	    path: '/ca/instrumentations',
	    port: CFG_PORT
	}, function (err, response, data) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, 200,
		    'bad HTTP status: ' + response.statusCode);
		var resp = JSON.parse(data);
		mod_assert.deepEqual(resp, exp, mod_ca.caSprintf(
		    'expected: %j, got: %j', exp, resp));
		mod_tl.ctStdout.info('Advancing from listInsts');
		mod_tl.advance(id);
	});
};

/*
 * Note that the id here is just to pass around to the advancing functions
 */
var invalidDelete = function (id)
{
	mod_tl.ctHttpRequest({
	    method: 'DELETE',
	    path: '/ca/instrumentations/foobar-err',
	    port: CFG_PORT
	}, function (err, response, data) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, 404,
		    'bad HTTP status: ' + response.statusCode);
		mod_tl.ctStdout.info('Advancing from invalidDelete');
		mod_tl.advance(id);
	});
};

/*
 * Tries to delete an instrumentation.
 */
var deleteInst = function (id)
{
	mod_tl.ctHttpRequest({
	    method: 'DELETE',
	    path: '/ca/instrumentations/' + id,
	    port: CFG_PORT
	}, function (err, response, data) {
		if (err)
			throw (err);

		mod_assert.equal(response.statusCode, 200,
		    'bad HTTP status: ' + response.statusCode);
		mod_tl.ctStdout.info('Advancing from deleteInsts');
		mod_tl.advance(id, []);
	});
};

/*
 * Push everything and start the test!
 */
mod_tl.ctSetTimeout(10 * 1000);
mod_tl.ctPushFunc(setup, startWorld, createInsts, listInsts, invalidDelete,
    listInsts, deleteInst, listInsts, function () { process.exit(0); });
mod_tl.ctStdout.info('Advancing to start the test');
mod_tl.advance();
