/*
 * ca-amqp-cap.js: Cloud Analytics-specific wrapper around generic AMQP
 * interface
 */

var mod_sys = require('sys');
var mod_events = require('events');

var mod_ca = require('ca');

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
 */
function capAmqpCap(args)
{
	var cap = this;

	this.cap_log = mod_ca.caFieldExists(args, 'log');
	this.cap_amqp = mod_ca.caFieldExists(args, 'amqp');
	this.cap_sysinfo = mod_ca.caFieldExists(args, 'sysinfo');
	this.cap_source = this.cap_amqp.routekey();

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
