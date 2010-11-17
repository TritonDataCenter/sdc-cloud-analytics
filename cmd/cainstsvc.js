/*
 * cainstsvc: Cloud Analytics Instrumenter service
 */

var mod_ca = require('ca');
var mod_caamqp = require('ca-amqp');
var mod_cap = require('ca-amqp-cap');

var ins_cap;		/* cap wrapper */
var ins_insts = {};	/* active instrumentations by id */
var ins_modules = {};	/* registered stat modules */
var ins_iid;		/* interval timer id */

var stdout = process.stdout;

function main()
{
	var broker = mod_ca.ca_amqp_default_broker;
	var sysinfo = mod_ca.caSysinfo('instsvc', '0.0');
	var hostname = sysinfo.ca_hostname;

	var amqp = new mod_caamqp.caAmqp({
		broker: broker,
		exchange: mod_ca.ca_amqp_exchange,
		exchange_opts: mod_ca.ca_amqp_exchange_opts,
		basename: mod_ca.ca_amqp_key_base_instrumenter,
		hostname: hostname,
		bindings: []
	});
	amqp.on('amqp-error', mod_caamqp.caAmqpLogError);
	amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError);

	ins_cap = new mod_cap.capAmqpCap({ amqp: amqp, sysinfo: sysinfo });
	ins_cap.on('msg-cmd-ping', insCmdPing);
	ins_cap.on('msg-cmd-status', insCmdStatus);
	ins_cap.on('msg-cmd-enable_instrumentation', insCmdEnable);
	ins_cap.on('msg-cmd-disable_instrumentation', insCmdDisable);

	console.log('Hostname:    ' + hostname);
	console.log('AMQP broker: ' + JSON.stringify(broker));
	console.log('Routing key: ' + amqp.routekey());

	insInitBackends();

	amqp.start(insStarted);
}

/*
 * Encapsulates the backend plugin interface.  This object is passed to each
 * plugin's insinit() function.  The plugin uses the methods of this object to
 * register its facilities with the Instrumenter.
 */
function insBackendInterface() {}

/*
 * Register a new metric module.  'args' must specify the following fields:
 *
 *	name	String identifier that names this module
 *
 *	label	Human-readable label for this module
 *
 * Each backend must register a given module before registering metrics in that
 * module.  Multiple backends may register modules with the same name but they
 * must all have the same label as well.
 */
insBackendInterface.prototype.registerModule = function (args)
{
	var name, label;

	name = mod_ca.caFieldExists(args, 'name', '');
	label = mod_ca.caFieldExists(args, 'label', '');

	if (!(name in ins_modules)) {
		ins_modules[name] = { label: label, stats: {} };
		return;
	}

	/*
	 * We want backends to be able to redeclare modules declared by other
	 * backends because we may have multiple implementations of the same
	 * metrics provided by the different backends.  For example, io.ops is
	 * implemented by both the kstat and dtrace backends.  The kstat version
	 * is cheaper but can't be used for predicates and decompositions.  When
	 * users enable one of these metrics, we use the lowest-cost
	 * implementation that can provide the desired predicates and
	 * decompositions.
	 *
	 * However, we don't want modules inadvertently reusing module names, so
	 * we check here to make sure the human-readable names match.  This is
	 * kinda hokey but should work for the foreseeable future.
	 */
	if (ins_modules[name] != label)
		throw (new Error('module "' + name +
		    '" redeclared with different label'));
};

/*
 * Register a new metric.  Metrics describe ways of instrumenting the system.
 * The implementation must specify an object implementing the insMetric
 * interface.  'args' specifies the following fields:
 *
 *	module, stat	Strings defining the metric's name using a two-level
 *			namespace (module name, then stat name).  This namespace
 *			is provided for users' convenience and may have nothing
 *			to do with the name of the backend plugin.  Backends can
 *			define metrics in multiple modules.  In fact, backends
 *			can define metrics with the same module and stat names
 *			as those defined by other modules.  This is useful when
 *			the different backends have different costs of
 *			instrumentation and different capabilities with respect
 *			to predicates and decomposition.  When users attempt to
 *			instrument a metric with multiple implementations, the
 *			Instrumenter uses the one that supports all desired
 *			breakdowns and decompositions that has the lowest cost.
 *
 *	XXX add costs either here or to module
 *
 *	label		Human-readable label for this metric
 *
 *	type		String type name for the scalar unit of this metric.
 *			May be one of "ops", "size", "throughput", "time", or
 *			"percent".
 *
 *	fields		Set of fields based on which data can be filtered or
 *			decomposed.  'fields' is an object whose keys are field
 *			names (identifiers) and whose values are objects with
 *			the following members:
 *
 *		label	Human-readable name for this field
 *
 *		type	Either 'scalar', 'string'.  Scalar fields allow
 *			predicates using numeric inequalities (e.g., ops > 500)
 *			and decompositions on scalar axes (e.g., x-axis,
 *			y-axis).  String fields only allow predicates using
 *			strict equality, and decompositions only use non-scalar
 *			axes (e.g., color).
 *
 *	metric		Function that returns a new instance of a class meeting
 *			the insMetric interface.
 *
 * The insMetric interface is used to implement individual metrics.  When a new
 * instrumentation is created based on this metric, a new instance of this class
 * is created using the function specified by 'metric' above.  (Note that this
 * function *returns* an instance -- it is not the constructor itself.)  The
 * sole argument to this constructor function is a description of the
 * instrumentation including 'inst_id' (instrumentation id, for identification
 * purposes only), 'module', 'stat', 'predicate', and 'decomposition' fields.
 * The object must implement the following methods:
 *
 *	instrument(callback):	Instrument the system to collect the specified
 *				metric.  Invoke the specified callback when
 *				instrumentation is complete.
 *
 *	deinstrument(callback):	Deinstrument the system to stop collecting the
 *				specified metric.  Invoke the specified callback
 *				when deinstrumentation is complete.
 *
 *	value():		Retrieve the current value of the metric.
 *				XXX is this since some time in the past?  Last
 *				read?
 */
insBackendInterface.prototype.registerMetric = function (args)
{
	var modname, statname, label, type, fields, metric, stat;

	modname = mod_ca.caFieldExists(args, 'module', '');
	statname = mod_ca.caFieldExists(args, 'stat', '');
	label = mod_ca.caFieldExists(args, 'label', '');
	type = mod_ca.caFieldExists(args, 'type', '');
	fields = mod_ca.caFieldExists(args, 'fields', []);
	metric = mod_ca.caFieldExists(args, 'metric');

	if (!(modname in ins_modules))
		throw (new Error('attempted declaration of metric in ' +
		    'undeclared module "' + modname + '"'));

	switch (type) {
	case 'ops':
	case 'size':
	case 'throughput':
	case 'time':
	case 'percent':
		break;
	default:
		throw (new Error('metric has invalid type: ' + type));
	}

	if (!(statname in ins_modules[modname]['stats']))
		ins_modules[modname]['stats'][statname] = [];

	stat = {};
	stat['label'] = label;
	stat['type'] = type;
	stat['metric'] = metric;
	stat['fields'] = mod_ca.caDeepCopy(fields);

	ins_modules[modname]['stats'][statname].push(stat);
};

/*
 * Search for installed Instrumenter backend plugins and load them.  We
 * currently hardcode this list, but ideally we'd find everything in some
 * particular directory.
 */
function insInitBackends()
{
	var backends = [ 'kstat', /* 'dtrace', */ 'test' ]; /* XXX */
	var bemgr = new insBackendInterface();
	var plugin, ii;

	for (ii = 0; ii < backends.length; ii++) {
		stdout.write('Loading module ' + backends[ii] + ' ... ');
		plugin = require('./cainst/modules/' + backends[ii]);
		plugin.insinit(bemgr);
		stdout.write('done.\n');
	}
}

function insStarted()
{
	var msg;

	console.log('AMQP broker connected.');

	msg = {};
	msg.ca_type = 'notify';
	msg.ca_subtype = 'instrumenter_online';
	msg.ca_modules = [];

	/* XXX should we send this periodically too?  every 5 min or whatever */
	ins_cap.send(mod_ca.ca_amqp_key_config, msg);

	ins_iid = setInterval(insTick, 1000);
}

/*
 * Invoked once/second to gather and report data.
 */
function insTick()
{
	var id, when, value;

	when = new Date(); /* XXX should this be reported by the subsystem? */

	for (id in ins_insts) {
		value = ins_insts[id].is_impl.value();
		ins_cap.send(ins_insts[id].is_inst_key, {
		    ca_type: 'data',
		    d_inst_id: id,
		    d_value: value,
		    ca_time: when
		});
	}
}

/*
 * Process AMQP ping command.
 */
function insCmdPing(msg)
{
	ins_cap.send(msg.ca_source, ins_cap.responseTemplate(msg));
}

/*
 * Process AMQP status command.
 */
function insCmdStatus(msg)
{
	var sendmsg = ins_cap.responseTemplate(msg);
	var id, inst;

	sendmsg.s_component = 'instrumenter';
	sendmsg.s_instrumentations = [];

	for (id in ins_insts) {
		inst = ins_insts[id];
		sendmsg.s_instrumentations.push({
		    s_inst_id: id,
		    s_module: inst.is_module,
		    s_stat: inst.is_stat,
		    s_predicate: inst.is_predicate,
		    s_decomposition: inst.is_decomposition,
		    s_since: inst.is_since
		});
	}

	ins_cap.send(msg.ca_source, sendmsg);
}

/*
 * Process AMQP command to enable an instrumentation.
 */
function insCmdEnable(msg)
{
	var sendmsg = ins_cap.responseTemplate(msg);
	var destkey = msg.ca_source;
	var id, metric, inst;

	sendmsg.is_inst_id = msg.is_inst_id;

	if (!('is_inst_id' in msg) || !('is_module' in msg) ||
	    !('is_stat' in msg) || !('is_predicate' in msg) ||
	    !('is_decomposition' in msg) || !('is_inst_key' in msg)) {
		sendmsg.is_status = 'enable_failed';
		sendmsg.is_error = 'missing field';
		ins_cap.send(destkey, sendmsg);
		return;
	}

	id = msg.is_inst_id;

	/*
	 * This command is idempotent so if we're currently instrumenting this
	 * instrumentation then we're already done.
	 */
	if (id in ins_insts) {
		/* XXX check that it matches */
		sendmsg.is_status = 'enabled';
		ins_cap.send(destkey, sendmsg);
		return;
	}

	if (!(msg.is_module in ins_modules) ||
	    !(msg.is_stat in ins_modules[msg.is_module]['stats'])) {
		sendmsg.is_status = 'enable_failed';
		sendmsg.is_error = 'unknown module or stat';
		ins_cap.send(destkey, sendmsg);
		return;
	}

	/*
	 * XXX parse predicate, decomposition to check for valid fields only
	 */
	metric = ins_modules[msg.is_module]['stats'][msg.is_stat][0];

	inst = {};
	inst.is_module = msg.is_module;
	inst.is_stat = msg.is_stat;
	inst.is_predicate = mod_ca.caDeepCopy(msg.is_predicate);
	inst.is_decomposition = mod_ca.caDeepCopy(msg.is_decomposition);
	inst.is_impl = metric.metric(inst);
	inst.is_inst_key = msg.is_inst_key;
	inst.is_since = new Date();

	ins_insts[id] = inst;
	inst.is_impl.instrument(function (err) {
		if (err) {
			sendmsg.is_status = 'enable_failed';
			sendmsg.is_error = 'instrumenter error: ' + err.message;
			ins_cap.send(destkey, sendmsg);
			return;
		}

		sendmsg.is_status = 'enabled';
		ins_cap.send(destkey, sendmsg);
		console.log('  instrumented ' + id + ' (' +
		    inst.is_module + '.' + inst.is_stat + ')');
	});
}

/*
 * Process AMQP command to disable an instrumentation.
 */
function insCmdDisable(msg)
{
	var sendmsg = ins_cap.responseTemplate(msg);
	var destkey = msg.ca_source;
	var id;

	if (!('is_inst_id' in msg)) {
		sendmsg.is_status = 'disable_failed';
		sendmsg.is_error = 'missing field';
		ins_cap.send(destkey, sendmsg);
		return;
	}

	id = msg.is_inst_id;
	sendmsg.is_inst_id = id;

	if (!(id in ins_insts)) {
		sendmsg.is_status = 'disabled';
		ins_cap.send(destkey, sendmsg);
		return;
	}

	ins_insts[id].is_impl.deinstrument(function (err) {
		if (err) {
			sendmsg.is_status = 'disable_failed';
			sendmsg.is_error = 'instrumenter error: ' + err.message;
			ins_cap.send(destkey, sendmsg);
			return;
		}

		sendmsg.is_status = 'disabled';
		ins_cap.send(destkey, sendmsg);
		delete (ins_insts[id]);
		console.log('deinstrumented ' + id);
	});
}

main();
