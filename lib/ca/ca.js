/*
 * ca.js: Cloud Analytics system constants and common routines.
 */

/*
 * We use only one global exchange of type 'topic'.
 */
exports.ca_amqp_exchange 		= 'amq.topic';
exports.ca_amqp_exchange_opts		= { type: 'topic' };

/*
 * Components on the AMQP network (config service, aggregators, and
 * instrumenters) each create their own key which encodes their type and a
 * unique identifier (usually hostname).
 */
exports.ca_amqp_key_base_aggregator	= 'ca.aggregator.';
exports.ca_amqp_key_base_config		= 'ca.config.';
exports.ca_amqp_key_base_instrumenter	= 'ca.instrumenter.';
exports.ca_amqp_key_base_tool		= 'ca.tool.';

/*
 * Each instrumentation gets its own key, which exactly one aggregator
 * subscribes to.  This facilitates distribution of instrumentation data
 * processing across multiple aggregators.
 */
exports.ca_amqp_key_base_instrumentation = 'ca.instrumentation.';

/*
 * To facilitate autoconfiguration, each component only needs to know about this
 * global config key.  Upon startup, a component sends a message to this key.
 * The configuration service receives these messages and responds with any
 * additional configuration data needed for this component.
 */
exports.ca_amqp_key_config 		= 'ca.config';

/*
 * Unlike the constants above, this default broker is specific to the deployment
 * environment.  But it's used in lots of places and this is the best place for
 * it.
 */
exports.ca_amqp_default_broker		= { host: '192.168.2.21' };

/*
 * The Cloud Analytics API is versioned with a major and minor number.  Software
 * components should ignore messages received with a newer major version number.
 */
exports.ca_amqp_vers_major		= 1;
exports.ca_amqp_vers_minor		= 1;

exports.caIncompatible = function (msg)
{
	return (msg.ca_major !== exports.ca_amqp_vers_major);
};

/*
 * Retry timeout and count: these parameters determine how hard we try to
 * recover when the AMQP broker disappears.
 */
exports.ca_amqp_retry_count		= 3;
exports.ca_amqp_retry_interval		= 5 * 1000; /* 5ms */

exports.caHostname = function ()
{
	/*
	 * XXX this should be synchronous and it should not require exec or the
	 * environment
	 */
	return (process.env['HOST']);
};

exports.caSysinfo = function (agentname, agentversion)
{
	/* XXX derive dynamically */
	return ({
	    ca_agent_name: agentname,
	    ca_agent_version: agentversion,
	    ca_os_name: 'SunOS',
	    ca_os_release: '5.11',
	    ca_os_revision: 'snv_121',
	    ca_hostname: exports.caHostname(),
	    ca_major: exports.ca_amqp_vers_major,
	    ca_minor: exports.ca_amqp_vers_minor
	});
};

/*
 * Deep copy an acyclic *basic* Javascript object.  This only handles basic
 * scalars (strings, numbers, booleans) and arbitrarily deep arrays and objects
 * containing these.  This does *not* handle instances of other classes.
 */
exports.caDeepCopy = function (obj)
{
	var ret, key;
	var marker = '__caDeepCopy';

	if (obj && obj[marker])
		throw (new Error('attempted deep copy of cyclic object'));

	if (typeof (obj) == typeof ({})) {
		ret = {};
		obj[marker] = true;

		for (key in obj)
			ret[key] = exports.caDeepCopy(obj[key]);

		delete (obj[marker]);
		return (ret);
	}

	if (typeof (obj) == typeof ([])) {
		ret = [];
		obj[marker] = true;

		for (key = 0; key < obj.length; key++)
			ret.push(exports.caDeepCopy(obj[key]));

		delete (obj[marker]);
		return (ret);
	}

	/*
	 * It must be a primitive type -- just return it.
	 */
	return (obj);
};
