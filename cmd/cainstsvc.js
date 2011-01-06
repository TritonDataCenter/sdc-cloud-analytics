/*
 * cainstsvc: Cloud Analytics Instrumenter service
 */

var mod_ca = require('../lib/ca/ca-common');
var mod_caamqp = require('../lib/ca/ca-amqp');
var mod_cap = require('../lib/ca/ca-amqp-cap');
var mod_log = require('../lib/ca/ca-log');

var ins_name = 'instsvc';	/* component name */
var ins_vers = '0.0';		/* component version */

var ins_insts = {};		/* active instrumentations by id */
var ins_modules = {};		/* registered stat modules */
var ins_iid;			/* interval timer id */

var ins_cap;			/* cap wrapper */
var ins_log;			/* log handle */

var stdout = process.stdout;

function main()
{
	var broker = mod_ca.caBroker();
	var sysinfo = mod_ca.caSysinfo(ins_name, ins_vers);
	var hostname = sysinfo.ca_hostname;
	var amqp;

	ins_log = new mod_log.caLog({ out: process.stdout });

	amqp = new mod_caamqp.caAmqp({
	    broker: broker,
	    exchange: mod_ca.ca_amqp_exchange,
	    exchange_opts: mod_ca.ca_amqp_exchange_opts,
	    basename: mod_ca.ca_amqp_key_base_instrumenter,
	    hostname: hostname,
	    bindings: [ 'ca.broadcast' ]
	});
	amqp.on('amqp-error', mod_caamqp.caAmqpLogError(ins_log));
	amqp.on('amqp-fatal', mod_caamqp.caAmqpFatalError(ins_log));

	ins_cap = new mod_cap.capAmqpCap({
	    amqp: amqp,
	    log: ins_log,
	    sysinfo: sysinfo
	});
	ins_cap.on('msg-cmd-ping', insCmdPing);
	ins_cap.on('msg-cmd-status', insCmdStatus);
	ins_cap.on('msg-cmd-enable_instrumentation', insCmdEnable);
	ins_cap.on('msg-cmd-disable_instrumentation', insCmdDisable);
	ins_cap.on('msg-notify-configsvc_online', insNotifyConfigRestarted);

	ins_log.info('Instrumenter starting up (%s/%s)', ins_name, ins_vers);
	ins_log.info('%-12s %s', 'Hostname:', hostname);
	ins_log.info('%-12s %s', 'AMQP broker:', JSON.stringify(broker));
	ins_log.info('%-12s %s', 'Routing key:', amqp.routekey());

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
	if (ins_modules[name].label != label)
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

	/*
	 * XXX it should be illegal (and we should check for this here) to
	 * define fields not already defined for this metric without also
	 * defining all existing fields for this metric.  That is, you can't
	 * define an implementation of a stat that's more flexible than an
	 * existing implementation in some ways and less flexible in others.
	 * Multiple implementations must be strictly more powerful (but of
	 * course may be more expensive).  This allows us to expose the
	 * abstraction of a single metric with multiple fields and then we just
	 * pick which the cheapest implementation that's flexible enough to do
	 * what we need, rather than having to expose multiple implementations
	 * to the config svc.
	 */
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
	/*
	 * Preference between different backends (determined by how expensive
	 * they are to use) is implicitly defined by the order in which they're
	 * loaded, not an explicit cost.
	 */
	var backends = [ 'kstat', 'dtrace' ];
	var bemgr = new insBackendInterface();
	var plugin, ii;

	ins_log.info('Loading modules.');

	for (ii = 0; ii < backends.length; ii++) {
		try {
			plugin = require('./cainst/modules/' + backends[ii]);
			plugin.insinit(bemgr, ins_log);
			ins_log.info('Loaded module "%s".', backends[ii]);
		} catch (ex) {
			ins_log.warn('FAILED to load module "%s": %s',
			    backends[ii], ex.toString());
		}
	}

	if (mod_ca.caIsEmpty(ins_modules))
		throw (new Error('No modules.  Bailing out.'));

	ins_log.info('Finished loading modules.');
}

function insGetModules()
{
	var modname, statname, fieldname;
	var mod, stat, mstats, mstat, mfield, ii;
	var donefields;
	var ret = [];

	for (modname in ins_modules) {
		mod = {};
		mod.cam_name = modname;
		mod.cam_description = ins_modules[modname]['label'];
		mod.cam_stats = [];

		for (statname in ins_modules[modname]['stats']) {
			donefields = {};
			mstats = ins_modules[modname]['stats'][statname];
			stat = {
			    cas_name: statname,
			    cas_fields: []
			};

			for (ii = 0; ii < mstats.length; ii++) {
				mstat = mstats[ii];
				stat.cas_description = mstat['label'];
				stat.cas_type = mstat['type'];

				for (fieldname in mstat['fields']) {
					if (fieldname in donefields)
						continue;
					donefields[fieldname] = true;
					mfield = mstat['fields'][fieldname];
					stat.cas_fields.push({
					    caf_name: fieldname,
					    caf_description: mfield['label'],
					    caf_type: mfield['type']
					});
				}
			}

			mod.cam_stats.push(stat);
		}

		ret.push(mod);
	}

	return (ret);
}

function insNotifyConfig()
{
	var mods = insGetModules();
	ins_cap.sendNotifyInstOnline(mod_ca.ca_amqp_key_config, mods);
}

function insStarted()
{
	ins_log.info('AMQP broker connected.');

	/* XXX should we send this periodically too?  every 5 min or whatever */
	insNotifyConfig();
	ins_iid = setInterval(insTick, 1000);
}

/*
 * Invoked once/second to gather and report data.
 */
var ins_last;

function insTick()
{
	var id, when, value, whentime;

	when = new Date(); /* XXX should this be reported by the subsystem? */
	whentime = when.getTime();

	/*
	 * If for some reason we get invoked multiple times within the same
	 * second, we ignore the subsequent invocations to avoid confusing the
	 * aggregator.
	 */
	if (ins_last &&
	    Math.floor(whentime / 1000) ==
	    Math.floor(ins_last.getTime() / 1000))
		return;

	for (id in ins_insts) {
		value = ins_insts[id].is_impl.value();
		ins_cap.sendData(ins_insts[id].is_inst_key, id, value,
			whentime);
	}

	ins_last = when;
}

/*
 * Process AMQP ping command.
 */
function insCmdPing(msg)
{
	ins_cap.sendCmdAckPing(msg.ca_source, msg.ca_id);
}

/*
 * Process AMQP status command.
 */
function insCmdStatus(msg)
{
	var sendmsg = {};
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

	sendmsg.s_modules = insGetModules();

	ins_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
}

/*
 * Process AMQP command to enable an instrumentation.
 */
function insCmdEnable(msg)
{
	var destkey = msg.ca_source;
	var id, metric, metrics, inst;
	var ii, jj;

	if (!('is_inst_id' in msg) || !('is_module' in msg) ||
	    !('is_stat' in msg) || !('is_predicate' in msg) ||
	    !('is_decomposition' in msg) || !('is_inst_key' in msg)) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'missing field', id);
		return;
	}

	id = msg.is_inst_id;

	/*
	 * This command is idempotent so if we're currently instrumenting this
	 * instrumentation then we're already done.
	 */
	if (id in ins_insts) {
		/* XXX check that it matches */
		ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	if (!(msg.is_module in ins_modules) ||
	    !(msg.is_stat in ins_modules[msg.is_module]['stats'])) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unknown module or stat', id);
		return;
	}

	metrics = ins_modules[msg.is_module]['stats'][msg.is_stat];

	for (ii = 0; ii < metrics.length; ii++) {
		for (jj = 0; jj < msg.is_decomposition.length; jj++) {
			if (!(msg.is_decomposition[jj] in metrics[ii].fields))
				break;
		}

		if (jj == msg.is_decomposition.length)
			break;
	}

	if (ii == metrics.length) {
		ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
		    'unsupported decomposition', id);
		return;
	}

	metric = ins_modules[msg.is_module]['stats'][msg.is_stat][ii];

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
			ins_cap.sendCmdAckEnableInstFail(destkey, msg.ca_id,
			    'instrumenter error: ' + err.message, id);
			return;
		}

		ins_cap.sendCmdAckEnableInstSuc(destkey, msg.ca_id, id);
		ins_log.info('instrumented %s (%s.%s)', id,
		    inst.is_module, inst.is_stat);
	});
}

/*
 * Process AMQP command to disable an instrumentation.
 */
function insCmdDisable(msg)
{
	var destkey = msg.ca_source;
	var id;

	if (!('is_inst_id' in msg)) {
		ins_cap.sendCmdAckDisableInstFail(destkey, msg.ca_id,
		    'missing field');
		return;
	}

	id = msg.is_inst_id;

	if (!(id in ins_insts)) {
		ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		return;
	}

	ins_insts[id].is_impl.deinstrument(function (err) {
		if (err) {
			ins_cap.sendCmdAckDisableInstFail(destkey, msg.ca_id,
			    'instrumenter error: ' + err.message, id);
			return;
		}

		ins_cap.sendCmdAckDisableInstSuc(destkey, msg.ca_id, id);
		delete (ins_insts[id]);
		ins_log.info('deinstrumented %s', id);
	});
}

/*
 * Invoked when the configuration service restarts.  Because instrumentations
 * are not yet persistent, we drop all the data we have and start again.
 */
function insNotifyConfigRestarted()
{
	var id;

	ins_log.info('config service restarted');

	if (mod_ca.caIsEmpty(ins_insts)) {
		insNotifyConfig();
		return;
	}

	for (id in ins_insts) {
		ins_insts[id].is_impl.deinstrument(function (err) {
		    delete (ins_insts[id]);

		    if (mod_ca.caIsEmpty(ins_insts))
			insNotifyConfig();
		});
	}
}

main();
