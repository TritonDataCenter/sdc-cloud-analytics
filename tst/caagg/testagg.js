var mod_assert = require('assert');
var mod_ca = require('../../lib/ca/ca-common');
var mod_cap = require('../../lib/ca/ca-amqp-cap');
var mod_tl = require('../../lib/tst/ca-test');

/*
 * testagg.js: Supplies the framework for testing that the aggregator is
 * creating the correct values. It takes two arguments, the first tells us which
 * type of test we should be using and the second is the number of fake
 * instrumenters that we should cons up to do this.
 *
 * Valid Types:
 * 'scalar' - Denotes that the instrumenters values should be just scalars
 *	i.e. data = 42
 * 'key-scalar' - Denotes that we should use a mapping of keys to scalars
 *	i.e. data = { foo: 42, bar: 43 }
 * 'simple-dist' - Denotes that the data is a distribution sans overlap
 *	i.e. data = [ [ [ 0, 10 ], 10 ] ]
 * 'hole-dist' - Donotes that instrumenters have different ranges of data
 * 'key-dist' - Denotes data that has keys whose value are distributions
 *	i.e. data - { foo: [ [ [ 0, 10 ], 10 ] ] }
 */

/*
 * Timeout if we don't succeed.
 */
mod_tl.ctSetTimeout(50 * 1000);


/*
 * Our callbacks - Callbacks should assert state and then advance the state
 * machine.
 */

/*
 * Unfortunately there is a race during start up and it's uncertain whether or
 * not we'll get the first aggOnline message.
 */
var notified = false;

var aggOnline = function (msg)
{
	var source = msg.ca_source;
	mod_tl.ctStdout.info('notified aggregator online');
	if (notified) {
		mod_tl.ctStdout.info('ignoring notified aggregator online');
		return;
	}
	notified = true;

	mod_tl.advance(source);
};

var aggEnabledAck = function (msg)
{
	var source = msg.ca_source;

	if (msg.ag_status != 'enabled') {
		mod_tl.ctStdout.error(mod_ca.caSprintf('Aggregation was ' +
			'not successfully enabled. Message: %j', msg));
		process.exit(1);
	}

	mod_tl.ctStdout.info('Advancing from aggEnabledAck');
	mod_tl.advance(source);
};

/*
 * Utility functions for generating data values
 */
var getDataKeyScalar = function (hostid, baseVal)
{
	var obj = {};
	obj[hostid] = hostid + baseVal;
	if (hostid > 0)
		obj[hostid-1] = baseVal;

	return (obj);
};

var createExpOutKeyScalar = function (nhosts, baseVal)
{
	var ret = {};
	var ii;

	for (ii = 0; ii < nhosts; ii++)
		ret[ii] = 0;

	ret[0] = baseVal;
	for (ii = 1; ii < nhosts; ii++) {
		ret[ii-1] += baseVal;
		ret[ii] += baseVal + ii;
	}

	return (ret);
};

var keyScalarDim = 2;
var keyScalarArity = mod_ca.ca_arity_discrete;

var getDataScalar = function (hostid, baseVal)
{
	return (baseVal);
};

var createExpOutScalar = function (nhosts, baseVal)
{
	return (nhosts*baseVal);
};

var scalarDim = 1;
var scalarArity = mod_ca.ca_arity_scalar;

/*
 * By default we populate 10 buckets in incs of 10
 */
var getDataSimpleDist = function (hostid, baseVal)
{
	var res = [];
	for (var ii = 0; ii < 10; ii++) {
		res.push([ [ ii*10, (ii+1)*10-1 ], baseVal + hostid]);
	}

	return (res);
};

var createExpOutSimpleDist = function (nhosts, baseVal)
{
	var res = [];
	for (var ii = 0; ii < 10; ii++) {
		var lbound = ii*10;
		var ubound = (ii+1)*10-1;
		var value = 0;
		for (var jj = 0; jj < nhosts; jj++) {
			value += baseVal + jj;
		}
		res.push([ [ lbound, ubound ], value ]);
	}

	return (res);
};

var simpleDistDim = 2;
var simpleDistArity = mod_ca.ca_arity_numeric;

/*
 * Here, we are testing distributions where all of the data has the same
 * buckets, but not every instrumenter has every value.
 *
 * The total spectrum consists of 10 buckets from 0-100 in increments of 10. We
 * have different outputs depending on the hostid % 10.
 * 0: 30-39, 70-79: baseVal
 */
var getDataHoleDist = function (hostid, baseVal)
{
	var res = [];

	switch (hostid % 3) {
		case 0:
			res.push([ [ 30, 39 ], baseVal ]);
			res.push([ [ 70, 79 ], baseVal ]);
			return (res);
		case 1:
			res.push([ [ 40, 49 ], baseVal ]);
			res.push([ [ 60, 69 ], baseVal ]);
			res.push([ [ 70, 79 ], baseVal ]);
			return (res);
		case 2:
			res.push([ [ 0, 9 ], baseVal ]);
			res.push([ [ 10, 19 ], baseVal ]);
			res.push([ [ 30, 39 ], baseVal ]);
			res.push([ [ 50, 59 ], baseVal ]);
			res.push([ [ 90, 99 ], baseVal ]);
			res.push([ [ 100, 109 ], baseVal ]);
			return (res);
		default:
			throw (new Error('Math failed at modulus'));
	}
};

var createExpOutHoleDist = function (nhosts, baseVal)
{
	var modZero, modOne, modTwo;
	var res = [];

	modZero = modOne = modTwo = parseInt(nhosts / 3, 10);
	if (nhosts % 3 == 1)
		modZero++;
	else if (nhosts % 3 == 2) {
		modZero++;
		modOne++;
	}

	/* We have to make sure we're ordered consistently */

	if (modTwo != 0) {
		res.push([ [ 0, 9 ], baseVal * modTwo ]);
		res.push([ [ 10, 19 ], baseVal * modTwo ]);
	}

	res.push([ [ 30, 39 ], baseVal*(modZero + modTwo) ]);

	if (modOne != 0)
		res.push([ [ 40, 49 ], baseVal * modOne ]);

	if (modTwo != 0)
		res.push([ [ 50, 59 ], baseVal * modTwo ]);

	if (modOne != 0)
		res.push([ [ 60, 69 ], baseVal * modOne ]);

	res.push([ [ 70, 79 ], baseVal*(modZero + modOne) ]);

	if (modTwo != 0) {
		res.push([ [ 90, 99 ], baseVal * modTwo ]);
		res.push([ [ 100, 109 ], baseVal * modTwo ]);
	}

	return (res);
};

var holeDistDim = 2;
var holeDistArity = mod_ca.ca_arity_numeric;


/*
 * We want to handle non-trivial overlapping. Thus hosts with an even hostid
 * will have the standard 0-100 10 bucket range. Hosts with an odd hostid will
 * have data that goes in increments of 5 from 23-73
 *
 * Because we're doing overlapping, we're going to simplify the values that are
 * going into buckets.
 *
 * We don't currently support these, but I'm leaving this here in case we ever
 * do end up supporting it.
 */
var getDataOverlapDist = function (hostid, baseVal)
{
	var res = [];
	var ii;

	if (hostid % 2 === 0) {
		for (ii = 0; ii < 10; ii++) {
			res.push([ [ ii*10, (ii+1)*10-1], baseVal]);
		}
	} else {
		for (ii = 0; ii < 10; ii++) {
			var lbound = 23 + (5*ii);
			var ubound = 23 + (5*ii) + 1;
			res.push([ [ lbound, ubound ], baseVal ]);
		}
	}

	return (res);
};

/*
 * We are going to have two different modulus functions. Some which determine
 * which key we use, the others which determine which set of values we use. To
 * maximize code reuse, we're just going to take advantage of the previous
 * hole-based mappings
 */
var getDataKeyDist = function (hostid, baseVal)
{
	var foo, bar, baz, res;
	foo = [];
	bar = [];
	baz = [];
	res = {};

	if (hostid % 3 === 0) {
		foo.push([ [ 30, 39 ], baseVal ]);
		bar.push([ [ 70, 79 ], baseVal ]);
		foo.push([ [ 70, 79 ], baseVal ]);
		foo.push([ [ 80, 89 ], baseVal ]);
		baz.push([ [ 10, 19 ], baseVal ]);
		baz.push([ [ 20, 29 ], baseVal ]);
	}

	if (hostid % 3 == 1) {
		bar.push([ [ 40, 49 ], baseVal ]);
		bar.push([ [ 60, 69 ], baseVal ]);
		foo.push([ [ 70, 79 ], baseVal ]);
		baz.push([ [ 60, 69 ], baseVal ]);
	}

	if (hostid % 3 == 2) {
		bar.push([ [ 0, 9 ], baseVal ]);
		foo.push([ [ 10, 19 ], baseVal ]);
		baz.push([ [ 30, 39 ], baseVal ]);
		bar.push([ [ 50, 59 ], baseVal ]);
		foo.push([ [ 90, 99 ], baseVal ]);
		baz.push([ [ 100, 109 ], baseVal ]);
		foo.push([ [ 100, 109 ], baseVal ]);
	}

	if (foo.length != 0) {
		res['foo'] = foo;
	}

	if (bar.length != 0) {
		res['bar'] = bar;
	}

	if (baz.length != 0) {
		res['baz'] = baz;
	}

	mod_tl.ctStdout.error(mod_ca.caSprintf('sending out data: %j', res));

	return (res);
};

var createExpOutKeyDist = function (nhosts, baseVal)
{
	var modZero, modOne, modTwo;
	var foo, bar, baz;
	foo = [];
	bar = [];
	baz = [];
	var res = {};

	modZero = modOne = modTwo = parseInt(nhosts / 3, 10);
	if (nhosts % 3 == 1)
		modZero++;
	else if (nhosts % 3 == 2) {
		modZero++;
		modOne++;
	}

	if (modTwo != 0) {
		bar.push([ [ 0, 9 ], baseVal * modTwo ]);
		foo.push([ [ 10, 19 ], baseVal * modTwo ]);
	}

	baz.push([ [ 10, 19 ], baseVal * modZero ]);
	baz.push([ [ 20, 29 ], baseVal * modZero ]);
	foo.push([ [ 30, 39 ], baseVal * modZero ]);

	if (modTwo != 0) {
		baz.push([ [ 30, 39 ], baseVal * modTwo ]);
	}

	if (modOne != 0) {
		bar.push([ [ 40, 49 ], baseVal * modOne ]);
	}

	if (modTwo != 0) {
		bar.push([ [ 50, 59 ], baseVal * modTwo ]);
	}

	if (modOne != 0) {
		bar.push([ [ 60, 69 ], baseVal * modOne ]);
		baz.push([ [ 60, 69 ], baseVal * modOne ]);
	}

	bar.push([ [ 70, 79 ], baseVal * modZero ]);
	foo.push([ [ 70, 79 ], baseVal * (modZero + modOne) ]);
	foo.push([ [ 80, 89 ], baseVal * modZero ]);

	if (modTwo != 0) {
		foo.push([ [ 90, 99 ], baseVal * modTwo ]);
		baz.push([ [ 100, 109 ], baseVal * modTwo ]);
		foo.push([ [ 100, 109 ], baseVal * modTwo ]);
	}

	if (foo.length != 0) {
		res['foo'] = foo;
	}

	if (bar.length != 0) {
		res['bar'] = bar;
	}

	if (baz.length != 0) {
		res['baz'] = baz;
	}

	return (res);
};

var keyDistDim = 3;
var keyDistArity = mod_ca.ca_arity_numeric;

var getDataUndefined = function (hostid, baseVal)
{
	return (undefined);
};

var createExpOutUndefined = function (nhosts, baseVal)
{
	return (0);
};

var undefinedDim = 1;
var undefinedArity = mod_ca.ca_arity_scalar;

/*
 * Variables that we want to use for the test
 */

var cid = 1;
var id = mod_tl.ctGetQualId(undefined, cid);
var baseValue = 42;
var insts = [];
var nsources, exp, createExpOut, getData, dim, arity;

if (process.argv.length != 4) {
	mod_tl.ctStdout.error('testagg.js: test-type nhosts');
	process.exit(1);
}

nsources = parseInt(process.argv[3], 10);
if (isNaN(nsources) || nsources <= 0) {
	mod_tl.ctStdout.error('testagg.js: invalid value for nhosts: ' +
	    nsources);
	process.exit(1);
}

switch (process.argv[2]) {
	case 'scalar':
		getData = getDataScalar;
		createExpOut = createExpOutScalar;
		dim = scalarDim;
		arity = scalarArity;
		break;
	case 'key-scalar':
		getData = getDataKeyScalar;
		createExpOut = createExpOutKeyScalar;
		dim = keyScalarDim;
		arity = keyScalarArity;
		break;
	case 'simple-dist':
		getData = getDataSimpleDist;
		createExpOut = createExpOutSimpleDist;
		dim = simpleDistDim;
		arity = simpleDistArity;
		break;
	case 'hole-dist':
		getData = getDataHoleDist;
		createExpOut = createExpOutHoleDist;
		dim = holeDistDim;
		arity = holeDistArity;
		break;
	case 'key-dist':
		getData = getDataKeyDist;
		createExpOut = createExpOutKeyDist;
		dim = keyDistDim;
		arity = keyDistArity;
		break;
	case 'undefined':
		getData = getDataUndefined;
		createExpOut = createExpOutUndefined;
		dim = undefinedDim;
		arity = undefinedArity;
		break;
	default:
		mod_tl.ctStdout.error('testagg.js: Invalid test type: ' +
		    process.argv[2]);
		process.exit(1);
		break;
}

mod_tl.ctStdout.info(mod_ca.caSprintf('Running test %s with %d instrumenters',
    process.argv[2], nsources));

mod_assert.ok(getData != null, 'bad getData function');
mod_assert.ok(createExpOut != null, 'bad createExpOut function');
mod_assert.ok(dim != null, 'bad dimension');

exp = createExpOut(nsources, baseValue);

/*
 * Fake service pieces
 */
function createInst(host)
{
	return (mod_tl.ctCreateCap({
		host: 'inst-' + host,
		type: 'instrumenter',
		bind: [ mod_cap.ca_amqp_key_all ]
	}));
}

for (var kk = 0; kk < nsources; kk++) {
	insts.push(createInst(kk));
}

var fakeConfig = mod_tl.ctCreateCap({
	host: 'config',
	type: 'config',
	bind: [ mod_cap.ca_amqp_key_config, mod_cap.ca_amqp_key_all ]
});

fakeConfig.on('msg-notify-aggregator_online', aggOnline);
fakeConfig.on('msg-ack-enable_aggregation', aggEnabledAck);

/*
 * Functions that we are going to use
 */

var startWorld = function ()
{
	for (var ii = 0; ii < nsources; ii++) {
		insts[ii].start();
	}

	fakeConfig.on('connected', function () {
		mod_tl.ctStdout.info('Called config service Online');
		mod_assert.ok(!notified);
		fakeConfig.sendNotifyCfgOnline(mod_cap.ca_amqp_key_all);
	});

	fakeConfig.start();
};

var enableAgg = function (source)
{
	var key = mod_cap.caRouteKeyForInst(id);
	var inst = {
	    'value-arity': arity,
	    'value-dimension': dim,
	    'enabled': true,
	    'retention-time': 600,
	    'nsources': nsources,
	    'granularity': 1,
	    transformations: []
	};
	mod_tl.ctStdout.info('Sending enable agg message: %j', inst);
	fakeConfig.sendCmdEnableAgg(source, id, id, key, inst);
};

var sendData = function (source)
{
	var time = new Date().getTime();
	mod_tl.ctStdout.info('Using time: ' + time);
	for (var ii = 0; ii < nsources; ii++) {
		var toSend = getData(ii, baseValue);
		mod_tl.ctStdout.info('ii: ' + ii + ' nsources: ' + nsources);
		insts[ii].sendData(source, id, toSend, time);
	}

	mod_tl.ctStdout.info('Advancing in sendData');
	mod_tl.advance(time);
};

var retrieveData = function (time)
{
	var response_data;
	var func = function (resFunc) {
	    var url = mod_ca.caSprintf(
		'/ca/instrumentations/%d/value/raw?start_time=%d',
		cid,
		parseInt(time / 1000, 10));
	    mod_tl.ctHttpRequest({
		method: 'GET',
		path: url,
		port: mod_ca.ca_http_port_agg_base
	    }, function (err, response, rdata) {
		if (err) {
			resFunc(err);
			return;
		}

		try {
			mod_assert.equal(response.statusCode, 200,
			    'bad HTTP status: ' + response.statusCode);
			response_data = JSON.parse(rdata);
			mod_assert.equal(response_data.minreporting, nsources);
		} catch (ex) {
			mod_tl.ctStdout.dbg('polling: %j', ex);
			resFunc(ex);
			return;
		}
		resFunc(null);
	    });
	};

	var next = function () { mod_tl.advance(response_data); };
	mod_tl.ctTimedCheck(func, next, 50, 500);
};

var checkData = function (rdata)
{
	mod_tl.ctStdout.info(mod_ca.caSprintf('Response: %j', rdata));

	mod_assert.deepEqual(rdata.value, exp,
	    mod_ca.caSprintf('wrong value for data: expected: %j,' +
	    'got msg: %j', exp, rdata));

	process.exit(0);
};

/*
 * Push everything
 */
mod_tl.ctPushFunc(startWorld, enableAgg, sendData, retrieveData, checkData);

/*
 * Start the test!
 */
mod_tl.ctStdout.info('Advancing to start the test');
mod_tl.advance();
