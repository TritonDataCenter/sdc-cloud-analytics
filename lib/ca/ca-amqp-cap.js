/*
 * ca-amqp-cap.js: Cloud Analytics-specific wrapper around generic AMQP
 * interface
 */

var mod_sys = require('sys');
var mod_events = require('events');
var ASSERT = require('assert').ok;

var mod_ca = require('./ca-common');
var mod_caerr = require('./ca-error');

/*
 * This structure describes all known message types and subtypes.  Message types
 * with no subtype object have no subtypes.  The value at each subtype is a
 * function for further processing.
 */
var cap_types = {
	cmd: {
	    disable_instrumentation: capDispatch,
	    enable_instrumentation: capDispatch,
	    enable_aggregation: capDispatch,
	    ping: capValidate,
	    status: capValidate
	},
	ack: {
	    disable_instrumentation: capDispatch,
	    enable_instrumentation: capDispatch,
	    enable_aggregation: capDispatch,
	    ping: capValidate,
	    status: capValidate
	},
	notify: {
	    aggregator_online: capValidate,
	    configsvc_online: capValidate,
	    instrumenter_error: capDispatch,
	    instrumenter_online: capValidate,
	    log: capValidate
	},
	data: capDispatch
};

/*
 * Wrap a caAmqp handle with this object to receive events for incoming messages
 * based on incoming message type and subtype, as specified by the Cloud
 * Analytics AMQP protocol.  This class also does common validation for some
 * message types.  'args' specifies the following members:
 *
 *	amqp	caAmqp handle
 *
 *	log	logger for recording debug messages
 *
 *	sysinfo	object specifying ca_major, ca_minor, ca_hostname,
 *		ca_agent_name, ca_agent_version, ca_os_name, ca_os_release,
 *		ca_os_revision
 *
 * and may specify the following member:
 *
 *	debug	if true, print out debug information for each message sent and
 *		received
 */
function capAmqpCap(args)
{
	var cap = this;

	this.cap_log = mod_ca.caFieldExists(args, 'log');
	this.cap_amqp = mod_ca.caFieldExists(args, 'amqp');
	this.cap_sysinfo = mod_ca.caFieldExists(args, 'sysinfo');
	this.cap_debug = args.debug === true;
	this.cap_source = this.cap_amqp.routekey();
	this.cap_cmds = {};
	this.cap_cmdid = 0;

	this.cap_amqp.on('msg', function (msg) { cap.receive(msg); });
}

mod_sys.inherits(capAmqpCap, mod_events.EventEmitter);
exports.capAmqpCap = capAmqpCap;

capAmqpCap.prototype.receive = function (msg)
{
	var type, subtype;
	var log = this.cap_log;

	if (!('ca_type') in msg) {
		log.warn('dropped message with unspecified type');
		return;
	}

	type = msg.ca_type;

	if (!(type in cap_types)) {
		log.warn('dropped message with unknown type: %s', type);
		return;
	}

	if (typeof (cap_types[type]) == typeof (arguments.callee)) {
		cap_types[type](this, msg);
		return;
	}

	if (type == 'cmd' && !('ca_id' in msg)) {
		log.warn('dropped cmd message with no id');
		return;
	}

	if (!('ca_time' in msg)) {
		log.warn('dropped message with unspecified time');
		return;
	}

	if (!('ca_hostname' in msg)) {
		log.warn('dropped message with unspecified hostname');
		return;
	}

	if (!('ca_source' in msg)) {
		log.warn('dropped message with unspecified source');
		return;
	}

	if (!('ca_subtype' in msg)) {
		log.warn('dropped message with unspecified subtype');
		return;
	}

	subtype = msg.ca_subtype;

	if (!(subtype in cap_types[type])) {
		log.warn('dropped message with unknown subtype: %s', subtype);
		return;
	}

	if (this.cap_debug)
		log.dbg('component %s received %s/%s', this.cap_amqp.routekey(),
		    type, subtype);

	cap_types[type][subtype](this, msg);
};

/*
 * Convenience routine for sending messages that automatically fills in
 * appropriate common fields.  This implementation has nasty knowledge of the
 * protocol, but then again that's what this module is for.
 */
capAmqpCap.prototype.send = function (routekey, msg)
{
	var type, subtype;
	var sendmsg;

	type = mod_ca.caFieldExists(msg, 'ca_type', '');
	sendmsg = mod_ca.caDeepCopy(msg);
	sendmsg.ca_source = this.cap_source;
	sendmsg.ca_hostname = this.cap_sysinfo.ca_hostname;

	if (!('ca_time' in msg))
		sendmsg.ca_time = new Date();

	if (typeof (cap_types[type]) == 'function') {
		this.cap_amqp.send(routekey, sendmsg);
		return;
	}

	subtype = mod_ca.caFieldExists(msg, 'ca_subtype', '');

	/*
	 * This is particularly unholy -- we're leveraging the knowledge that
	 * capValidate is used to check received messages for the additional
	 * sysinfo fields, so if we're sending one of these messages then we'd
	 * better make sure to include them.
	 */
	if (cap_types[type][subtype] == capValidate)
		mod_ca.caDeepCopyInto(sendmsg, this.cap_sysinfo);

	if (this.cap_debug)
		this.cap_log.dbg('component %s sending %s/%s to %s',
		    this.cap_amqp.routekey(), type, subtype, routekey);

	this.cap_amqp.send(routekey, sendmsg);
};

/*
 * Convenience routine for constructing a response message for a given command.
 */
capAmqpCap.prototype.responseTemplate = function (msg)
{
	var sendmsg = {};

	if (msg.ca_type != 'cmd')
		throw (new Error('response templates are only for cmds'));

	sendmsg.ca_type = 'ack';
	sendmsg.ca_subtype = msg.ca_subtype;
	sendmsg.ca_id = msg.ca_id;

	return (sendmsg);
};

capAmqpCap.prototype.bind = function (routekey, callback)
{
	this.cap_amqp.bind(routekey, callback);
};

function capDispatch(cap, msg)
{
	var eventname;

	if (msg.ca_type == 'ack' && cap.ack(msg))
		return;

	eventname = 'msg-' + msg.ca_type;

	if ('ca_subtype' in msg)
		eventname += '-' + msg.ca_subtype;

	if (cap.listeners(eventname).length === 0)
		cap.cap_log.warn('dropped ignored message of type "%s"',
		    eventname);

	cap.emit(eventname, msg);
}

function capValidate(cap, msg)
{
	if (mod_ca.caIncompatible(msg)) {
		cap.cap_log.warn('dropped message with incompatible version');
		return;
	}

	capDispatch(cap, msg);
}

/*
 * The following set of functions are all wrappers around the cloud analytics
 * private AMQP protocol. The current version of the protocol is found on the
 * wiki.
 *
 * These functions try to be consistent across one another. The first argument
 * to all of them is the routing key.
 *
 * One class of ack failures is a missing argument. Because of this, we have
 * split up all of the ack functions.
 */

capAmqpCap.prototype.sendNotifyCfgOnline = function (route)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'configsvc_online';
	this.send(route, msg);
};

/*
 * mods is an array of instrumenter modules with fields per the cloud analytics
 * AMQP spec
 */
capAmqpCap.prototype.sendNotifyInstOnline = function (route, mods)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'instrumenter_online';
	msg.ca_modules = mods;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyAggOnline = function (route, port, trans)
{
	var msg = {};

	ASSERT(port);
	msg.ca_type = 'notify';
	msg.ca_subtype = 'aggregator_online';
	msg.ag_http_port = port;
	msg.ag_transformations = trans;
	this.send(route, msg);
};

/*
 * key is the unique routing key for this instrumentation
 * dim corresponds to the number of dimensions that we are using
 * the fields for inst should match the HTTP spec
 */
capAmqpCap.prototype.sendCmdEnableAgg = function (route, id, aggId, key,
    inst)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'enable_aggregation';
	msg.ag_inst_id = aggId;
	msg.ag_key = key;
	msg.ag_instrumentation = inst;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableAggSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_aggregation';
	msg.ca_id = id;
	msg.ag_inst_id = instId;
	msg.ag_status = 'enabled';
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableAggFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_aggregation';
	msg.ca_id = id;
	if (instId)
		msg.ag_inst_id = instId;
	msg.ag_status = 'enable_failed';
	if (error)
		msg.ag_error = error;
	this.send(route, msg);
};

/*
 * spec is the struct that corresponds to the following information:
 *  - modname
 *  - statname
 *  - decomp
 *  - predicate
 */
capAmqpCap.prototype.sendCmdEnableInst = function (route, id, instId, key, spec,
    zones)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'enable_instrumentation';
	msg.is_inst_key = key;
	msg.is_inst_id = instId;
	msg.is_module = spec.modname;
	msg.is_stat = spec.statname;
	msg.is_predicate = spec.pred;
	msg.is_decomposition = spec.decomp;

	if (zones)
		msg.is_zones = zones;

	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableInstSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_instrumentation';
	msg.ca_id = id;
	msg.is_inst_id = instId;
	msg.is_status = 'enabled';
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckEnableInstFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'enable_instrumentation';
	msg.ca_id = id;
	if (instId)
		msg.is_inst_id = instId;
	msg.is_status = 'enable_failed';
	if (error)
		msg.is_error = error;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdDisableInst = function (route, id, instId)
{
	var msg = {};

	msg.ca_id = id;
	msg.ca_type = 'cmd';
	msg.ca_subtype = 'disable_instrumentation';
	msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDisableInstFail = function (route, id, error,
	instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'disable_instrumentation';
	msg.ca_id = id;
	msg.is_status = 'disable_failed';
	if (error)
		msg.is_error = error;
	if (instId)
		msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckDisableInstSuc = function (route, id, instId)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'disable_instrumentation';
	msg.ca_id = id;
	msg.is_status = 'disabled';
	msg.is_inst_id = instId;
	this.send(route, msg);
};

capAmqpCap.prototype.sendData = function (route, instId, value, time)
{
	var msg = {};

	msg.ca_type = 'data';
	msg.d_inst_id = instId;
	msg.d_value = value;
	msg.d_time = time;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdPing = function (route, id)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = 'ping';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdAckPing = function (route, id)
{
	var msg = {};

	msg.ca_type = 'ack';
	msg.ca_subtype = 'ping';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendCmdStatus = function (route, id)
{
	var msg = {};

	msg.ca_type = 'cmd';
	msg.ca_subtype = 'status';
	msg.ca_id = id;
	this.send(route, msg);
};

/*
 * Data is an object that corresponds to the per-component specific data.
 */
capAmqpCap.prototype.sendCmdAckStatus = function (route, id, data)
{
	var msg = mod_ca.caDeepCopy(data);

	msg.ca_type = 'ack';
	msg.ca_subtype = 'status';
	msg.ca_id = id;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyLog = function (route, message)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'log';
	msg.l_message = message;
	this.send(route, msg);
};

capAmqpCap.prototype.sendNotifyInstError = function (route, instId, error,
	status)
{
	var msg = {};

	msg.ca_type = 'notify';
	msg.ca_subtype = 'instrumenter_error';
	msg.ins_inst_id = instId;
	msg.ins_error = error;
	msg.ins_status = status;
	this.send(route, msg);
};

capAmqpCap.prototype.cmdEnableAgg = function (route, instid, instkey, props,
    timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.ag_status != 'enabled')
			return (callback(caError(ECA_REMOTE, null,
			    'failed to enable aggregator')));

		return (callback(null, true));
	});

	this.sendCmdEnableAgg(route, cmdid, instid, instkey, props);
};

capAmqpCap.prototype.cmdEnableInst = function (route, instid, instkey, props,
    zones, timeout, callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.is_status != 'enabled')
			return (callback(caError(ECA_REMOTE, null,
			    'failed to enable instrumenter: %s',
			    msg.is_error)));

		return (callback(null, true));
	});

	this.sendCmdEnableInst(route, cmdid, instid, instkey, {
	    modname: props['module'],
	    statname: props['stat'],
	    pred: props['predicate'],
	    decomp: props['decomposition']
	}, zones);
};

capAmqpCap.prototype.cmdDisableInst = function (route, instid, timeout,
    callback)
{
	var cmdid;

	cmdid = this.cmd(timeout, function (err, msg) {
		if (err)
			return (callback(err));

		if (msg.is_status != 'disabled')
			return (callback(caError(ECA_REMOTE, null,
			    'failed to disable instrumenter: %s',
			    msg.is_error)));

		return (callback(null, true));
	});

	this.sendCmdDisableInst(route, cmdid, instid);
};

/*
 * [private] Returns an id used to send a new command.  The callback will be
 * invoked when that command returns.
 */
capAmqpCap.prototype.cmd = function (timeout, callback)
{
	var id, tid;
	var cap = this;

	/*
	 * Our ID scheme is pretty simple: "auto" plus a monotonically
	 * increasing number.  We could have different numbers based on the
	 * hostname, but we don't bother.  All that really matters is that it be
	 * unique, and particularly that it not overlap with those that might be
	 * used by another consumer of this object sending raw commands.
	 */
	id = 'auto.' + this.cap_cmdid++;
	this.cap_cmds[id] = function (msg) {
		if (timeout)
			clearTimeout(tid);
		callback(null, msg);
	};

	if (!timeout)
		return (id);

	tid = setTimeout(function () {
		delete (cap.cap_cmds[id]);
		callback(new caError(ECA_TIMEDOUT));
	}, timeout);
	return (id);
};

/*
 * [private] Invoked when we receive an "ack" message.  If this corresponds to a
 * command we sent out, invoke our own callback and return true to indicate that
 * we consumed this message.  Otherwise our caller will pass it on to another
 * consumer.
 */
capAmqpCap.prototype.ack = function (msg)
{
	var id;

	ASSERT(msg.ca_type == 'ack');

	if (!('ca_id' in msg))
		return (false);

	id = msg.ca_id;

	if (!(id in this.cap_cmds))
		return (false);

	this.cap_cmds[id](msg);
	delete (this.cap_cmds[id]);
	return (true);
};
