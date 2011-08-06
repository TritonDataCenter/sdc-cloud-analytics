/*
 * ca-svc-config.js: configuration service implementation and related functions
 */

/*
 * INSTRUMENTATION MANAGEMENT
 *
 * The configuration service (configsvc) orchestrates all work done by the Cloud
 * Analytics distributed service.  Specifically, it's responsible for:
 *
 *	o handling user HTTP requests, including those which create
 *	  instrumentations, retrieve values, modify instrumentations, and delete
 *	  instrumentations
 *
 *	o managing the persistence of CA service configuration (mainly the set
 *	  of instrumentations and their configurations) using the stash service
 *
 *	o directing the aggregators and instrumenters that make up the CA
 *	  service, making sure that each component knows what it should be doing
 *
 *	o contacting MAPI to retrieve the list of zones a user is authorized to
 *	  instrument and which hosts those zones are on so that the appropriate
 *	  instrumenters are enabled when the user creates an instrumentation
 *
 * The unit of configuration and user interaction is the instrumentation, often
 * abbreviated "instn" in the code below.  Each instn is represented in-memory
 * by a caCfgInstn object (defined below) and on disk in its own stash bucket.
 * (see instnLoad() below).
 *
 * There are two ways instns enter the system: the user creates them with an
 * HTTP request, or they're loaded from the stash as part of configsvc startup.
 * In both cases the configsvc then ensures that the appropriate aggregator and
 * instrumenters are up-to-date with respect to this instn's configuration.  For
 * each instn, there are several pieces of state which must be kept in sync:
 *
 *	o on-disk state (stash service)
 *	o aggregator state
 *	o list of hosts/zones (retrieved from MAPI)
 *	o instrumenter state (for each instrumenter)
 *
 * Each of these is represented by a "task".  For simplicity, each instn runs
 * tasks in sequence, but different instns' tasks can run concurrently.  See
 * instnTask(), instnRun(), and instnTask*() below.
 */

var mod_ca = require('./ca-common');
var mod_cap = require('./ca-amqp-cap');
var mod_cahttp = require('./ca-http');
var mod_caerr = require('./ca-error');
var mod_capred = require('./ca-pred');
var mod_dbg = require('./ca-dbg');
var mod_md = require('./ca-metadata');
var mod_profile = require('./ca-profile');
var mod_metric = require('./ca-metric');
var mod_log = require('./ca-log');
var mod_mapi = require('./ca-mapi');
var mod_assert = require('assert');
var ASSERT = mod_assert.ok;
var HTTP = require('./http-constants');

var cfg_agg_maxinsts = 50;		/* max # of insts per aggregator */
var cfg_timeout_aggenable = 5 * 1000;	/* 5 seconds for aggregator */
var cfg_timeout_instenable = 10 * 1000;	/* 10 seconds per instrumenter */
var cfg_timeout_instdisable = 10 * 1000;

var cfg_retain_min = 10;		/* min data retention time: 10 sec */
var cfg_retain_default = 10 * 60;	/* default data retention: 10 min */

var cfg_granularity_default = 1;		/* 1 second */
var cfg_datapoints_max = 60 * 60;		/* 1 hour at per-second */

var cfg_idle_max_min = 0;			/* never expire */
var cfg_idle_max_max = 60 * 60 * 24 * 7;	/* 1 week */
var cfg_idle_max_default = 60 * 60;		/* 1 hour */

var cfg_http_uri_cust = '/customers';
var cfg_http_uri_inst = '/instrumentations';
var cfg_http_uri_raw  = '/value/raw';
var cfg_http_uri_heatmap_image = '/value/heatmap/image';
var cfg_http_uri_heatmap_details = '/value/heatmap/details';

var cfg_name = 'configsvc';		/* component name */
var cfg_vers = '0.0';			/* component version */
var cfg_http_port = mod_ca.ca_http_port_config;	/* HTTP port */
var cfg_http_uri_base = '/ca';		/* base URI for HTTP API */
var cfg_instn_max_peruser = 10;		/* maximum allowed instns per user */
var cfg_reaper_interval = 60 * 1000;	/* time between reaps (ms) */
var cfg_stash_vers_major = 0;		/* major rev of configsvc config */
var cfg_stash_vers_minor = 0;		/* minor rev of configsvc config */

/*
 * Represents an instrumentation inside the configuration service.  We use a
 * class here only to leverage common code for initialization.  There's no
 * implied encapsulation; rather, the config service code reaches directly into
 * this object to manipulate state.
 */
function caCfgInstn(conf)
{
	mod_assert.ok(conf.instn_id);
	mod_assert.ok(conf.uri_base);
	mod_assert.ok(conf.aggregator);
	mod_assert.ok(conf.properties);

	this.cfi_uri_base = conf.uri_base;
	this.cfi_scopeid = conf.scope_id;
	this.cfi_instnid = conf.instn_id;
	this.cfi_fqid = mod_ca.caQualifiedId(this.cfi_scopeid,
	    this.cfi_instnid);
	this.cfi_aggr = conf.aggregator;
	this.cfi_instrs = {};
	this.cfi_tasks = [];

	this.cfi_props = caNormalizeProperties(this.cfi_uri_base,
	    this.cfi_scopeid, this.cfi_instnid, conf.properties);
}

/*
 * The caConfigService object manages all of the state for the configsvc,
 * including active instrumentations and their pending tasks, known aggregators
 * and instrumenters, and available value transformations.  The only public
 * methods are the usual service methods:
 *
 *	start()		starts the service
 *
 *	stop()		stops the service (cannot be restarted)
 *
 *	routekey()	retrieves the AMQP routing key for this service
 *
 * The implementation is primarily partitioned into the following groups of
 * methods:
 *
 *	http*		handle user HTTP requests (and helper functions)
 *
 *	amqp*		handle AMQP messages
 *
 *	load*		handles initial load from the stash
 *	migrate*	handles migration of legacy stash configuration
 *
 *	instnTask*	implements per-instn async tasks (see above)
 *	instnRun
 *	instn*		other instrumentation object helpers
 */
function caConfigService(argv, loglevel)
{
	var mdpath;

	/* constants / tunables */
	this.cfg_name = cfg_name;
	this.cfg_vers = cfg_vers;
	this.cfg_http_port = cfg_http_port;
	this.cfg_http_uri_base = cfg_http_uri_base;
	this.cfg_instn_max_peruser = cfg_instn_max_peruser;
	this.cfg_reaper_interval = cfg_reaper_interval;
	this.cfg_dbg = new mod_dbg.caDbgRingBuffer(100);

	/* configuration */
	this.cfg_sysinfo = mod_ca.caSysinfo(this.cfg_name, this.cfg_vers);
	this.cfg_mapicfg = mod_ca.caMapiConfig();
	this.cfg_queue = mod_cap.ca_amqp_key_base_config +
	    this.cfg_sysinfo.ca_hostname;

	if (arguments.length < 2)
		loglevel = mod_log.DBG;

	this.cfg_log = new mod_log.caLog({
	    out: process.stderr,
	    level: loglevel
	});

	ASSERT(argv.length > 0);
	mdpath = argv[0];

	/* log files */
	if (argv.length > 1) {
		this.cfg_dbglog = mod_log.caLogFromFile(argv[1],
		    { candrop: true }, mod_log.caLogError(this.cfg_log));
		this.cfg_log.info('Logging AMQP messages to "%s"', argv[1]);
	}

	if (argv.length > 2) {
		this.cfg_rqlog = mod_log.caLogFromFile(argv[2],
		    { candrop: true }, mod_log.caLogError(this.cfg_log));
		this.cfg_log.info('Logging HTTP requests to "%s"', argv[2]);
	}

	/* state */
	this.cfg_metrics = new mod_metric.caMetricSet();
	this.cfg_metadata = new mod_metric.caMetricMetadata();
	this.cfg_aggrs = {};	/* known aggregators, by hostname */
	this.cfg_instrs = {};	/* known instrumenters, by hostname */
	this.cfg_xforms = {};	/* supported transformations */
	this.cfg_last = {};	/* last access time for each instn */
	this.cfg_npending = 0;

	/* AMQP connection */
	this.cfg_cap = new mod_cap.capAmqpCap({
	    dbglog: this.cfg_dbglog,
	    keepalive: true,
	    log: this.cfg_log,
	    queue: this.cfg_queue,
	    sysinfo: this.cfg_sysinfo
	});

	this.cfg_cap.bind(mod_cap.ca_amqp_key_config);
	this.cfg_cap.bind(mod_cap.ca_amqp_key_all);

	this.cfg_cap.on('msg-notify-configsvc_online', mod_ca.caNoop);
	this.cfg_cap.on('msg-notify-config_reset', mod_ca.caNoop);
	this.cfg_cap.on('msg-cmd-status', this.amqpStatus.bind(this));
	this.cfg_cap.on('msg-notify-aggregator_online',
	    this.amqpAggOnline.bind(this));
	this.cfg_cap.on('msg-notify-instrumenter_online',
	    this.amqpInstrOnline.bind(this));
	this.cfg_cap.on('msg-notify-log', this.amqpLog.bind(this));
	this.cfg_cap.on('msg-notify-instrumenter_error',
	    this.amqpInstrError.bind(this));

	/* HTTP server */
	this.cfg_http = new mod_cahttp.caHttpServer({
	    log: this.cfg_log,
	    port: this.cfg_http_port,
	    router: this.httpRouter.bind(this),
	    log_requests: this.cfg_rqlog
	});

	/* external services */
	if (this.cfg_mapicfg)
		this.cfg_mapi = new mod_mapi.caMapi(this.cfg_mapicfg);

	this.cfg_mdmgr = new mod_md.caMetadataManager(
	    this.cfg_log, mdpath);

	this.cfg_instns = {};
	this.cfg_globals = {};
	this.cfg_custs = {};
	this.cfg_dead = {};
	this.cfg_nextid = 1;
}

exports.caConfigService = caConfigService;

caConfigService.prototype.start = function (callback)
{
	var svc, stages, log;

	ASSERT(this.cfg_start === undefined, 'service cannot be restarted');

	this.cfg_start = new Date().getTime();

	svc = this;
	stages = [];
	log = this.cfg_log;

	log.info('Config service starting up (%s/%s)', this.cfg_name,
	    this.cfg_vers);
	log.info('%-12s %s', 'Hostname:', this.cfg_sysinfo.ca_hostname);
	log.info('%-12s %s', 'AMQP broker:',
	    JSON.stringify(this.cfg_cap.broker()));
	log.info('%-12s %s', 'Routing key:', this.cfg_queue);
	log.info('%-12s Port %d', 'HTTP server:', this.cfg_http_port);

	if (this.cfg_mapi) {
		log.info('%-12s %s:%s', 'MAPI host:', this.cfg_mapicfg.host,
		    this.cfg_mapicfg.port);
	} else {
		log.warn('MAPI_HOST, MAPI_PORT, MAPI_USER, or ' +
		    'MAPI_PASSWORD not set.  Per-customer use disabled.');
	}

	/* stage 1: load metadata from disk */
	stages.push(function (unused, subcallback) {
		svc.cfg_mdmgr.load(subcallback);
	});

	/* stage 2: load metadata into memory */
	stages.push(function (unused, subcallback) {
		svc.cfg_profiles = new mod_profile.caProfileManager();
		svc.cfg_profiles.load(svc.cfg_mdmgr);

		svc.cfg_profile_customer = svc.cfg_profiles.get('customer');
		if (!svc.cfg_profile_customer)
			return (subcallback(new caError(ECA_INVAL, null,
			    'customer profile not found')));

		svc.cfg_profile_operator = svc.cfg_profiles.get('operator');
		if (!svc.cfg_profile_operator)
			return (subcallback(new caError(ECA_INVAL, null,
			    'operator profile not found')));

		return (subcallback());
	});

	/* stage 3: start the HTTP server */
	stages.push(function (unused, subcallback) {
		log.info('Finished loading metadata');
		svc.cfg_http.start(subcallback);
	});

	/* stage 4: connect to the AMQP broker */
	stages.push(function (unused, subcallback) {
		log.info('HTTP server started');
		svc.cfg_cap.on('connected', svc.amqpConnected.bind(svc));
		svc.cfg_cap.start();
		subcallback();
	});

	/* stage 5: load configuration from stash service */
	stages.push(function (unused, subcallback) {
		svc.loadConfig(subcallback);
	});

	caRunStages(stages, null, function (err) {
		if (err)
			return (callback(new caError(err.code(), err,
			    'failed to start up server')));

		svc.cfg_reaper_timeout = setTimeout(
		    svc.tickReaper.bind(svc), svc.cfg_reaper_interval);

		return (callback());
	});
};

/*
 * Stop the service and wait for any outstanding operations to finish.
 */
caConfigService.prototype.stop = function (callback)
{
	var svc, fqid, instn;

	this.cfg_log.info('service stopping');

	svc = this;
	mod_assert.ok(!this.cfg_stopped);
	this.cfg_stopped = true;

	clearTimeout(this.cfg_reaper_timeout);

	/*
	 * Flush the task queues for all instrumentations, active and dead, so
	 * that we don't try to do any more work after we wait for the ongoing
	 * tasks.
	 */
	for (fqid in this.cfg_instns) {
		instn = this.cfg_instns[fqid];
		this.instnTasksFlush(instn);
	}

	for (fqid in this.cfg_dead) {
		instn = this.cfg_dead[fqid];
		this.instnTasksFlush(instn);
	}

	/*
	 * Wait for all pending tasks to complete.
	 */
	svc.cfg_log.info('stop: %d pending', this.cfg_npending);

	this.cfg_ondone = function () {
		if (svc.cfg_npending > 0)
			return;

		mod_assert.equal(svc.cfg_npending, 0);
		svc.cfg_http.stop(function () {
			svc.cfg_log.info('http service stopped');
			svc.cfg_cap.on('disconnected', callback);
			svc.cfg_cap.stop();
		});
	};

	this.cfg_ondone();
};

/*
 * Our configuration is stored in the following buckets:
 *
 *	ca.config.config: legacy global configuration
 *
 *	ca.config.instn.<instid>: config for instn <instid>
 */
caConfigService.prototype.loadConfig = function (callback)
{
	var svc = this;

	/*
	 * In this first stage of loading configuration from the stash we
	 * retrieve the contents of our legacy stash bucket (ca.config.config)
	 * as well as a listing of the whole stash, from which we figure out
	 * which instrumentations exist.  Since there's nothing else for us to
	 * do, we continue trying until we succeed or fail explicitly.
	 */
	this.cfg_cap.cmdDataGet(mod_cap.ca_amqp_key_stash, 10000,
	    [ { bucket: '.contents' }, { bucket: 'ca.config.config' } ],
	    function (err, results) {
		if (err) {
			if (err.code() != ECA_TIMEDOUT)
				return (callback(new caError(err.code(), err,
				    'failed to retrieve configuration')));

			svc.cfg_log.warn('timed out retrieving config; ' +
			    'trying again');
			return (svc.loadConfig(callback));
		}

		/*
		 * If there was an existing legacy configuration, we migrate
		 * that first.  migrateConfig() will call back into this
		 * function to load config again after completing the migration.
		 */
		if ('result' in results[1])
			return (svc.migrateConfig(results[1], callback));

		if (results[1]['error']['code'] != ECA_NOENT)
			return (callback(new caError(ECA_REMOTE, null,
			    'failed remotely to retrieve legacy config: %s',
			    results[0]['error']['message'])));

		if (!('result' in results[0]))
			return (callback(new caError(ECA_REMOTE, null,
			    'failed remotely to retrieve contents: %s',
			    results[0]['error']['message'])));

		/*
		 * Parse the bucket contents and continue loading.
		 */
		try {
			results = JSON.parse(results[0]['result']['data']);
		} catch (ex) {
			return (callback(new caError(ECA_REMOTE, ex,
			    'failed to parse contents bucket')));
		}

		return (svc.loadConfigFrom(results, callback));
	});
};

/*
 * Given the list of all stash buckets, pick out the ones corresponding to
 * instrumentation configuration, retrieve them, and load the corresponding
 * instrumentations.
 */
caConfigService.prototype.loadConfigFrom = function (allbuckets, callback)
{
	var svc, buckets;

	svc = this;
	buckets = Object.keys(allbuckets).filter(function (bktkey) {
		return (caStartsWith(bktkey, 'ca.config.instn.'));
	});

	this.cfg_log.info('retrieving config for %d instns', buckets.length);
	this.cfg_cap.cmdDataGet(mod_cap.ca_amqp_key_stash, 10000,
	    buckets.map(function (bktid) { return ({ bucket: bktid }); }),
	    function (err, bktcontents) {
		if (err)
			return (callback(new caError(ECA_REMOTE, err,
			    'failed to load instn buckets')));

		svc.cfg_log.info('restoring config from stash');
		bktcontents.forEach(function (instnbkt, ii) {
			var data;

			if (!('result' in instnbkt)) {
				svc.cfg_log.error(
				    'failed to read bucket "%s": %s',
				    buckets[ii], instnbkt['error']['message']);
				return;
			}

			try {
				data = JSON.parse(instnbkt['result']['data']);
			} catch (ex) {
				svc.cfg_log.error(
				    'failed to parse bucket "%s": %r',
				    buckets[ii], ex);
				return;
			}

			svc.instnLoad(data);
		});

		return (callback());
	    });
};

/*
 * Load an instrumentation from its persistent configuration object.  The object
 * has the following fields:
 *
 *	aggregator		name of assigned aggregator, if assigned
 *
 *	scope_id		scope (customer) id (undefined means global)
 *
 *	instn_id		per-scope instrumentation id
 *
 *	properties		last known property values
 *
 *	zonesbyhost		zones to instrument, keyed by hostname
 *				(cache -- may not be up to date)
 */
caConfigService.prototype.instnLoad = function (instnconf)
{
	var instn, hostname, scope, scopeinfo;

	hostname = instnconf['aggregator'];

	if (!(hostname in this.cfg_aggrs))
		this.cfg_aggrs[hostname] = {
		    cag_hostname: hostname,
		    cag_ninsts: 0
		};

	instn = new caCfgInstn({
		scope_id: instnconf['scope_id'],
		instn_id: instnconf['instn_id'],
		uri_base: this.cfg_http_uri_base,
		properties: instnconf['properties'],
		aggregator: this.cfg_aggrs[hostname]
	});

	instn.cfi_zonesbyhost = instnconf['zonesbyhost'];
	this.cfg_instns[instn.cfi_fqid] = instn;
	this.cfg_last[instn.cfi_fqid] = new Date().getTime();
	this.cfg_aggrs[hostname].cag_ninsts++;

	if (instn.cfi_scopeid === undefined) {
		scope = this.cfg_globals;
		this.cfg_nextid = Math.max(this.cfg_nextid,
		    instnconf['instn_id'] + 1);
	} else {
		if (!(instn.cfi_scopeid in this.cfg_custs))
			this.cfg_custs[instn.cfi_scopeid] = {
				insts: {}, id: 1
			};

		scopeinfo = this.cfg_custs[instn.cfi_scopeid];
		scope = scopeinfo['insts'];

		scopeinfo['id'] = Math.max(scopeinfo['id'],
		    instnconf['instn_id'] + 1);
	}

	scope[instn.cfi_fqid] = true;

	/*
	 * Make sure the aggregator knows about this instrumentation and update
	 * the list of zones/hosts that we need to instrument.  The latter will
	 * trigger an update of all the instrumenters that need to be notified.
	 */
	this.instnTask(instn, this.instnTaskAggrUpdate);
	this.instnTask(instn, this.instnTaskZonesUpdate);
	this.instnDbg(instn, true, 'reloaded from stash');
};

/*
 * Prior to the Mango release, all CA configuration was stored in a single
 * bucket.  It's now stored in per-instrumentation buckets.  To migrate a legacy
 * config, we simply save per-instrumentation config for each of the
 * instrumentations in the legacy config, and then delete the legacy config
 * bucket.  Because we don't allow users to make changes to instrumentations
 * until migration is complete, this process is idempotent and therefore
 * crash-safe too.
 */
caConfigService.prototype.migrateConfig = function (legacybucket, callback)
{
	var svc, metadata, contents, data, custid, rqs, stages;

	svc = this;
	metadata = legacybucket['result']['metadata'];
	contents = legacybucket['result']['data'];

	svc.cfg_log.info('migrating configuration');

	if (metadata.cfg_vers_major > cfg_stash_vers_major)
		return (callback(new caError(ECA_INVAL, null,
		    'expected configsvc config version %s.%s (got %s.%s)',
		    cfg_stash_vers_major, cfg_stash_vers_minor,
		    metadata.cfg_vers_major, metadata.cfg_vers_minor)));

	try {
		data = JSON.parse(contents);
	} catch (ex) {
		return (callback(new caError(ECA_INVAL, ex,
		    'failed to parse configsvc config')));
	}

	rqs = this.migrateScope(data['global'], data['instns']);
	for (custid in data['customers'])
		rqs = rqs.concat(this.migrateScope(
		    data['customers'][custid]['insts'], data['instns']));

	/*
	 * Now that we've assembled the list of "put" requests, send those
	 * requests to the stash and delete the original config.
	 */
	stages = [];

	stages.push(function (unused, subcallback) {
		svc.cfg_cap.cmdDataPut(mod_cap.ca_amqp_key_stash, 10000, rqs,
		    subcallback);
	});

	stages.push(function (results, subcallback) {
		var nerrs = 0;

		results.forEach(function (rv, ii) {
			if (!('error' in rv))
				return;

			svc.cfg_log.error('failed to migrate %s: %s',
			    rqs[ii]['bucket'], rv['error']['message']);
			nerrs++;
		});

		if (nerrs > 0)
			return (subcallback(new caError(ECA_REMOTE, null,
			    'failed to migrate %d instns', nerrs)));

		return (subcallback());
	});

	stages.push(function (unused, subcallback) {
		svc.cfg_cap.cmdDataDelete(mod_cap.ca_amqp_key_stash, 10000,
		    [ { bucket: 'ca.config.config' } ], subcallback);
	});

	return (caRunStages(stages, null, function (err) {
		if (err)
			return (callback(new caError(ECA_REMOTE, err,
			    'failed to remove legacy config')));

		/*
		 * Once we're done, reload the configuration from scratch.
		 */
		svc.cfg_log.info('successfully migrated configuration');
		return (svc.loadConfig(callback));
	}));
};

/*
 * Returns an array of stash "put" requests to save all the instrumentations in
 * the given "scope", whose properties are contained in "instns".
 */
caConfigService.prototype.migrateScope = function (scope, instns)
{
	var rqs, fqid, ent;

	rqs = [];

	for (fqid in scope) {
		ent = instns[fqid];
		rqs.push(this.instnSaveRequest(ent['cust_id'], ent['inst_id'],
		    ent['properties'], ent['zonesbyhost'], ent['aggregator']));
	}

	return (rqs);
};

/*
 * We destroy idle instrumentations to avoid accumulating garbage that users
 * have long forgotten about.  We do this by keeping track of the last accessed
 * time in cfg_last[fqid] and periodically (here in the reaper callback) we
 * destroy those instrumentations whose last access time is longer ago than
 * their "idle-max" property.  All instrumentations get a fresh start when we
 * come up since we don't want to persist this configuration.
 */
caConfigService.prototype.tickReaper = function ()
{
	var now, fqid, instn, last, idlemax;

	now = new Date().getTime();

	for (fqid in this.cfg_instns) {
		instn = this.cfg_instns[fqid];
		last = this.cfg_last[fqid];
		ASSERT(last > 0);
		idlemax = instn.cfi_props['idle-max'];
		if (idlemax === 0 || now - last <= idlemax * 1000)
			continue;

		this.instnDbg(instn, true, 'expired (last: %s)',
		    new Date(last));
		this.instnTask(instn, this.instnTaskDelete);
	}

	this.cfg_reaper_last = now;
	this.cfg_reaper_timeout = setTimeout(this.tickReaper.bind(this),
	    this.cfg_reaper_interval);
};

/*
 * Invoked when we connect to the AMQP broker, both the first time and for
 * subsequent reconnects.
 */
caConfigService.prototype.amqpConnected = function ()
{
	this.cfg_log.info('AMQP broker connected');
	this.cfg_cap.sendNotifyCfgOnline(mod_cap.ca_amqp_key_all);
};

/*
 * Respond to the CA-AMQP "status" command with information about configured
 * instrumentations, instrumenters, and aggregators.
 */
caConfigService.prototype.amqpStatus = function (msg)
{
	var key, instr, aggr;
	var sendmsg = {};
	var svc = this;

	sendmsg.s_component = 'config';

	sendmsg.s_instrumenters = [];
	for (key in this.cfg_instrs) {
		instr = this.cfg_instrs[key];
		sendmsg.s_instrumenters.push({
		    sii_hostname: instr.ins_hostname,
		    sii_nmetrics_avail: 'unknown',
		    sii_ninsts: 'unknown'
		});
	}

	sendmsg.s_aggregators = [];
	for (key in this.cfg_aggrs) {
		aggr = this.cfg_aggrs[key];
		sendmsg.s_aggregators.push({
		    sia_hostname: aggr.cag_hostname,
		    sia_ninsts: aggr.cag_ninsts
		});
	}

	this.status(function (status) {
		sendmsg.s_status = status;
		svc.cfg_cap.sendCmdAckStatus(msg.ca_source, msg.ca_id, sendmsg);
	}, false, 0);
};

/*
 * Respond to the CA-AMQP "aggregator online" command.  We update our internal
 * information about this aggregator and its capabilities and then notify it of
 * any instrumentations it's supposed to be aggregating.
 */
caConfigService.prototype.amqpAggOnline = function (msg)
{
	var log, fqid, aggr, action, trans, ipaddr;

	log = this.cfg_log;

	if (!('ag_http_port' in msg)) {
		log.warn('ignoring aggonline msg with no port: %j', msg);
		return;
	}

	if (!('ag_transformations' in msg)) {
		log.warn('ignoring aggonline msg with no ' +
		    'transformations: %j', msg);
		return;
	}

	if (msg.ca_hostname in this.cfg_aggrs) {
		aggr = this.cfg_aggrs[msg.ca_hostname];
		action = 'restarted';
	} else {
		aggr = this.cfg_aggrs[msg.ca_hostname] = {};
		action = 'started';
		aggr.cag_ninsts = 0;
	}

	ipaddr = ('ag_http_ipaddr' in msg) ? msg.ag_http_ipaddr : '127.0.0.1';

	aggr.cag_hostname = msg.ca_hostname;
	aggr.cag_routekey = msg.ca_source;
	aggr.cag_agent_name = msg.ca_agent_name;
	aggr.cag_agent_version = msg.ca_agent_version;
	aggr.cag_os_name = msg.ca_os_name;
	aggr.cag_os_release = msg.ca_os_release;
	aggr.cag_os_revision = msg.ca_os_revision;
	aggr.cag_http_ipaddr = ipaddr;
	aggr.cag_http_port = msg.ag_http_port;
	aggr.cag_transformations = msg.ag_transformations;

	for (trans in aggr.cag_transformations) {
		if (trans in this.cfg_xforms)
			continue;

		this.cfg_xforms[trans] = aggr.cag_transformations[trans];
	}

	log.info('aggregator %s: %s', action, msg.ca_hostname);

	for (fqid in this.cfg_instns) {
		if (aggr != this.cfg_instns[fqid].cfi_aggr)
			continue;

		this.instnTask(this.cfg_instns[fqid], this.instnTaskAggrUpdate);
	}
};

/*
 * Respond to the CA-AMQP "instrumenter online" command.  We update our internal
 * information about this instrumenter and its capabilities and then notify it
 * of any instrumentations it's supposed to have active.
 */
caConfigService.prototype.amqpInstrOnline = function (msg)
{
	var instr, instn, action, fqid, log;

	if (msg.ca_hostname in this.cfg_instrs) {
		instr = this.cfg_instrs[msg.ca_hostname];
		action = 'restarted';
	} else {
		instr = this.cfg_instrs[msg.ca_hostname] = {};
		action = 'started';
	}

	log = this.cfg_log;
	log.info('instrumenter %s: %s', action, msg.ca_hostname);

	instr.ins_hostname = msg.ca_hostname;
	instr.ins_routekey = msg.ca_source;
	instr.ins_agent_name = msg.ca_agent_name;
	instr.ins_agent_version = msg.ca_agent_version;
	instr.ins_os_name = msg.ca_os_name;
	instr.ins_os_release = msg.ca_os_release;
	instr.ins_os_revision = msg.ca_os_revision;

	try {
		this.cfg_metadata.addFromHost(msg.ca_metadata, msg.ca_hostname);
	} catch (ex) {
		if (!(ex instanceof caError && ex.code() == ECA_INVAL))
			throw (ex);

		/*
		 * There's a conflict or otherwise invalid metadata.  Log the
		 * error and then forget about this instrumenter.
		 */
		log.warn('instrumenter %s: error processing metric ' +
		    'metadata: %r', msg.ca_hostname, ex);
		this.cfg_metrics.addFromHost([], msg.ca_hostname);
		return;
	}

	this.cfg_metrics.addFromHost(msg.ca_metadata['metrics'],
	    msg.ca_hostname);

	/*
	 * If this instrumenter has just started up for the first time, we need
	 * to tell all global instrumentations to refresh their zones/host list
	 * so that these instns get propagated to the new instr.
	 */
	if (action == 'started') {
		for (fqid in this.cfg_globals)
			this.instnTask(this.cfg_instns[fqid],
			    this.instnTaskZonesUpdate);
	}

	/*
	 * In the case that this instrumenter is not new, we must tell any
	 * instns which are supposed to be running on this host to re-propagate
	 * their configuration to update the restarted instr.
	 */
	for (fqid in this.cfg_instns) {
		instn = this.cfg_instns[fqid];

		if (!(instr.ins_hostname in instn.cfi_instrs))
			/* instn not enabled on this instr */
			continue;

		instn.cfi_instrs[instr.ins_hostname]['state'] = false;
		this.instnTask(instn, this.instnTaskInstrsUpdate);
	}
};

/*
 * Handle an incoming CA-AMQP "log" message.  Just log the message.
 */
caConfigService.prototype.amqpLog = function (msg)
{
	if (!('l_message' in msg)) {
		this.cfg_log.warn('dropped log message with missing message');
		return;
	}

	this.cfg_log.warn('from %s: %s %s', msg.ca_hostname, msg.ca_time,
	    msg.l_message);
};

/*
 * Handle an incoming CA-AMQP "instrumenter error" message.  Just log the error.
 */
caConfigService.prototype.amqpInstrError = function (msg)
{
	if (!('ins_inst_id' in msg) || !('ins_error' in msg) ||
	    !('ins_status' in msg) || (msg['ins_status'] != 'enabled' &&
	    msg['ins_status'] != 'disabled')) {
		this.cfg_log.warn('dropping malformed instr error message');
		return;
	}

	if (!(msg.ca_hostname in this.cfg_instrs)) {
		this.cfg_log.warn('dropping instr error message for unknown ' +
		    'host "%s"', msg.ca_hostname);
		return;
	}

	this.cfg_log.error('host "%s" reports instrumenter error (now %s): %s',
	    msg.ca_hostname, msg.ins_status, msg.ins_error);
};

/*
 * Given a "connect" HTTP server, register handlers for our API's resources.
 */
caConfigService.prototype.httpRouter = function (server)
{
	var infixes, resources;
	var ii, jj, base, uri, impl;

	infixes = [ '', '/customers/:custid' ];

	resources = [ {
	    method: 'get',
	    suffix: '/docs',
	    impl: this.httpDocs
	}, {
	    method: 'get',
	    suffix: '',
	    impl: this.httpConfigList
	}, {
	    method: 'get',
	    suffix: '/metrics',
	    impl: this.httpLegacyMetricsList
	}, {
	    method: 'get',
	    suffix: '/types',
	    impl: this.httpLegacyTypesList
	}, {
	    method: 'get',
	    suffix: '/transformations',
	    impl: this.httpLegacyXformsList
	}, {
	    method: 'get',
	    suffix: '/instrumentations',
	    impl: this.httpInstnsList
	}, {
	    method: 'post',
	    suffix: '/instrumentations',
	    impl: this.httpInstnCreate
	}, {
	    method: 'del',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnDelete
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnGetProps
	}, {
	    method: 'put',
	    suffix: '/instrumentations/:instid',
	    impl: this.httpInstnSetProps
	}, {
	    method: 'post',
	    suffix: '/instrumentations/:instid/clone',
	    impl: this.httpInstnClone
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid/value',
	    impl: this.httpInstnValue
	}, {
	    method: 'get',
	    suffix: '/instrumentations/:instid/value/*',
	    impl: this.httpInstnValue
	} ];

	server.get(this.cfg_http_uri_base + '/admin/status',
	    this.httpAdminStatus.bind(this));

	for (ii = 0; ii < infixes.length; ii++) {
		base = this.cfg_http_uri_base + infixes[ii];

		for (jj = 0; jj < resources.length; jj++) {
			uri = base + resources[jj]['suffix'];
			impl = resources[jj]['impl'].bind(this);
			server[resources[jj]['method']](uri, impl);
		}
	}
};

/*
 * Checks whether we've loaded our persistent configuration yet.  If not, we
 * fail requests with 503 (service unavailable).
 */
caConfigService.prototype.httpReady = function (request, response)
{
	if (this.cfg_instns)
		return (true);

	response.send(HTTP.ESRVUNAVAIL);
	return (false);
};

/*
 * Return the metric set appropriate for the given request based on whether the
 * request is scoped to a particular profile.
 */
caConfigService.prototype.httpMetricSet = function (request)
{
	var mset = this.cfg_metrics;

	/*
	 * Customers (identified by the customer ID in the URL) are always
	 * limited by the "customer" profile.
	 */
	if (request.params['custid'] !== undefined)
		return (this.cfg_profile_customer.metrics().intersection(mset));

	/*
	 * Operators are allowed to explicitly override profiles.  This is used
	 * primarily by the tests to avoid having to to write tests that match
	 * actual profiles.
	 */
	if (request.ca_params['profile'] == 'none')
		return (mset);

	return (this.cfg_profile_operator.metrics().intersection(mset));
};

/*
 * Return the instrumentation specified by the given request URI, or "undefined"
 * if none is specified.  If this function returns "undefined", it has already
 * sent an appropriate error response to the client.
 */
caConfigService.prototype.httpInstn = function (request, response)
{
	var custid, instid, fqid, instn;

	if (!this.httpReady(request, response))
		return (undefined);

	custid = request.params['custid'];
	instid = request.params['instid'];
	fqid = mod_ca.caQualifiedId(custid, instid);
	instn = this.cfg_instns[fqid];

	if (!instn) {
		response.send(HTTP.ENOTFOUND);
		return (undefined);
	}

	this.cfg_last[fqid] = new Date().getTime();
	return (instn);
};

/*
 * Reads instrumentation properties from form fields or the request body.
 */
caConfigService.prototype.httpInstnProps = function (request)
{
	var actuals, props, fields, ii;

	/*
	 * If the user specified a JSON object, we use that.  Otherwise, we
	 * assume they specified parameters in form fields.
	 */
	if (request.ca_json && typeof (request.ca_json) == typeof ({}))
		actuals = request.ca_json;
	else
		actuals = request.ca_params;

	props = {};
	fields = [ 'module', 'stat', 'predicate', 'decomposition', 'enabled',
	    'retention-time', 'idle-max', 'granularity', 'persist-data' ];

	for (ii = 0; ii < fields.length; ii++) {
		if (fields[ii] in actuals)
			props[fields[ii]] = actuals[fields[ii]];
	}

	return (props);
};

/*
 * Respond to HTTP requests for /ca/admin/status.  Return basic status info.
 */
caConfigService.prototype.httpAdminStatus = function (request, response)
{
	var params, recurse, timeout;

	params = {
	    recurse: { type: 'boolean',	default: false },
	    timeout: { type: 'number',	default: 5,	min: 1, max: 60 }
	};

	try {
		recurse = mod_ca.caHttpParam(params,
		    request.ca_params, 'recurse');
		timeout = mod_ca.caHttpParam(params,
		    request.ca_params, 'timeout');
	} catch (ex) {
		if (!(ex instanceof caValidationError))
			throw (ex);

		response.sendError(ex);
		return;
	}

	this.status(function (result) {
		response.send(HTTP.OK, result);
	}, recurse, timeout * 1000);
};

caConfigService.prototype.httpDocs = function (request, response)
{
	mod_cahttp.caHttpFileServe(request, response, './docs/overview.htm');
};

/*
 * Respond to HTTP requests for /ca[/customers/:custid]/.  Return the list of
 * available metrics and related metadata.
 */
caConfigService.prototype.httpConfigList = function (request, response)
{
	var set, ret;

	set = this.httpMetricSet(request);
	ret = mod_metric.caMetricHttpSerialize(set, this.cfg_metadata);
	ret['transformations'] = this.cfg_xforms;
	response.send(HTTP.OK, ret);
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/metrics.  Returns a list of available metrics.
 */
caConfigService.prototype.httpLegacyMetricsList = function (request, response)
{
	var set, metrics, metric, module, stat, fields, field;
	var fieldtype, md, ret, ii, jj;

	md = this.cfg_metadata;
	set = this.httpMetricSet(request);
	ret = {};

	metrics = set.baseMetrics();
	for (ii = 0; ii < metrics.length; ii++) {
		metric = metrics[ii];
		module = metric.module();
		stat = metric.stat();

		if (!(module in ret))
			ret[module] = {
			    label: md.moduleLabel(module),
			    stats: {}
			};

		ret[module]['stats'][stat] = {
		    label: md.metricLabel(module, stat),
		    type: 'unused',
		    fields: {}
		};

		fields = metric.fields();
		for (jj = 0; jj < fields.length; jj++) {
			field = fields[jj];

			if (field == 'latency' || field == 'runtime' ||
			    field == 'cputime')
				fieldtype = 'latency';
			else if (md.fieldArity(field) == 'numeric')
				fieldtype = 'number';
			else
				fieldtype = 'string';

			ret[module]['stats'][stat]['fields'][field] = {
			    label: md.fieldLabel(field),
			    type: fieldtype
			};
		}
	}

	response.send(HTTP.OK, ret);
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/types.  Returns a list of types used in the available
 * metrics.
 */
caConfigService.prototype.httpLegacyTypesList = function (request, response)
{
	response.send(HTTP.OK, {
	    latency: 'numeric',
	    string: 'discrete',
	    number: 'numeric'
	});
};

/*
 * Respond to HTTP requests for the legacy entry point
 * /ca[/customers/:custid]/transformations.  Returns a list of transformations
 * used in the available metrics.
 */
caConfigService.prototype.httpLegacyXformsList = function (request, response)
{
	response.send(HTTP.OK, this.cfg_xforms);
};

/*
 * Respond to HTTP requests for /ca[/customers/:custid]/instrumentations.  Lists
 * all active instrumentations.
 */
caConfigService.prototype.httpInstnsList = function (request, response)
{
	var custid, scope, fqid, rv;

	if (!this.httpReady(request, response))
		return;

	custid = request.params['custid'];

	if (custid === undefined && request.ca_params['all'] === 'true')
		scope = this.cfg_instns;
	else if (custid === undefined)
		scope = this.cfg_globals;
	else if (custid in this.cfg_custs)
		scope = this.cfg_custs[custid]['insts'];
	else
		scope = {};

	rv = [];
	for (fqid in scope)
		rv.push(this.cfg_instns[fqid].cfi_props);

	response.send(HTTP.OK, rv);
};

/*
 * Respond to HTTP requests for GET
 * /ca[/customers/:custid]/instrumentations/:instid.  Returns properties for the
 * specified instrumentation.
 */
caConfigService.prototype.httpInstnGetProps = function (request, response)
{
	var instn;

	if (!(instn = this.httpInstn(request, response)))
		return;

	response.send(HTTP.OK, instn.cfi_props);
};

/*
 * Respond to HTTP requests for POST /ca[/customers/:custid]/instrumentations.
 * Creates a new instrumentation.
 */
caConfigService.prototype.httpInstnCreate = function (request, response)
{
	if (this.httpReady(request, response))
		this.instnCreate(request, response,
		    this.httpInstnProps(request));
};

/*
 * Respond to HTTP requests for DELETE
 * /ca[/customers/:custid]/instrumentations/:instid.  Deletes the specified
 * instrumentation.
 */
caConfigService.prototype.httpInstnDelete = function (request, response)
{
	var instn;

	if (!(instn = this.httpInstn(request, response)))
		return;

	this.instnTask(instn, this.instnTaskDelete, function (err) {
		if (err)
			response.sendError(err);
		else
			response.send(HTTP.NOCONTENT);
	});
};

/*
 * Respond to HTTP requests for PUT
 * /ca[/customers/:custid]/instrumentations/:instid.  Sets and returns
 * properties for the specified instrumentation.
 */
caConfigService.prototype.httpInstnSetProps = function (request, response)
{
	var instn, svc, props, mutables, ii, newprops;

	if (!(instn = this.httpInstn(request, response)))
		return;

	svc = this;
	props = this.httpInstnProps(request);

	try {
		mutables = caInstValidateMutableFields(props,
		    instn.cfi_scopeid === undefined);
	} catch (ex) {
		response.sendError(ex);
		return;
	}

	this.instnTask(instn, function setprops(unused, callback) {
		svc.instnDbg(instn, true, 'setting new props: %j', props);
		newprops = caDeepCopy(instn.cfi_props);

		for (ii = 0; ii < mutables.length; ii++) {
			if (mutables[ii] in props)
				newprops[mutables[ii]] = props[mutables[ii]];
		}

		newprops = caNormalizeProperties(instn.cfi_uri_base,
		    instn.cfi_scopeid, instn.cfi_instnid, newprops);
		svc.instnTaskSave(instn, callback, newprops);
	}, function (err) {
		if (err)
			return (response.sendError(err));

		instn.cfi_props = newprops;
		svc.instnTask(instn, svc.instnTaskAggrUpdate);
		return (response.send(HTTP.OK, newprops));
	});
};

/*
 * Respond to HTTP requests for POST
 * /ca[/customers/:custid]/instrumentations/:instid/clone.  Creates a new
 * instrumentation based on the specified one.
 */
caConfigService.prototype.httpInstnClone = function (request, response)
{
	var oinstn, rqprops, props, prop;

	if (!(oinstn = this.httpInstn(request, response)))
		return;

	rqprops = this.httpInstnProps(request);
	props = caDeepCopy(oinstn.cfi_props);
	for (prop in rqprops)
		props[prop] = rqprops[prop];

	this.instnCreate(request, response, props);
};

/*
 * Respond to HTTP requests for
 * /ca[/customers/:custid]/instrumentations/:instid/value[/...].  Forwards the
 * request to the corresponding aggregator.
 */
caConfigService.prototype.httpInstnValue = function (request, response)
{
	var instn, aggr, ipaddr, port;

	instn = this.httpInstn(request, response);
	if (!instn)
		return (undefined);

	aggr = instn.cfi_aggr;
	ipaddr = aggr.cag_http_ipaddr;
	port = aggr.cag_http_port;

	if (!ipaddr || !port)
		return (response.send(HTTP.ESRVUNAVAIL));

	return (mod_cahttp.caHttpForward(request, response, ipaddr, port,
	    this.cfg_log));
};

caConfigService.prototype.instnCreate = function (request, response, props)
{
	var svc, scopeid, instnid, instn, aggr, set, log;

	svc = this;
	log = this.cfg_log;
	log.info('request to instrument:\n%j', props);

	scopeid = request.params['custid'];
	set = this.httpMetricSet(request);
	aggr = this.pickAggregator();

	try {
		props = this.instnValidateProps(props, set, scopeid);

		if (scopeid !== undefined && !(scopeid in this.cfg_custs))
			this.cfg_custs[scopeid] = { insts: {}, id: 1 };

		this.instnValidateScope(scopeid);
	} catch (ex) {
		response.sendError(ex);
		return;
	}

	instnid = scopeid === undefined ? this.cfg_nextid++ :
	    this.cfg_custs[scopeid]['id']++;

	instn = new caCfgInstn({
		scope_id: scopeid,
		instn_id: instnid,
		uri_base: this.cfg_http_uri_base,
		aggregator: aggr,
		properties: props
	});

	aggr.cag_ninsts++;
	this.instnDbg(instn, true, 'picked aggr %s', aggr.cag_hostname);

	this.instnTask(instn, this.instnTaskSave, function (err) {
		var headers;

		if (err) {
			aggr.cag_ninsts--;
			response.sendError(err);
			return;
		}

		svc.cfg_instns[instn.cfi_fqid] = instn;
		svc.cfg_last[instn.cfi_fqid] = new Date().getTime();

		if (scopeid === undefined)
			svc.cfg_globals[instn.cfi_fqid] = true;
		else
			svc.cfg_custs[scopeid]['insts'][instn.cfi_fqid] = true;

		svc.instnDbg(instn, true, 'created');
		headers = { 'Location': instn.cfi_props['uri'] };
		response.send(HTTP.CREATED, instn.cfi_props, headers);

		svc.instnTask(instn, svc.instnTaskAggrUpdate);
		svc.instnTask(instn, svc.instnTaskZonesUpdate);
	});
};

/*
 * [private] Returns an available aggregator.  We currently choose a random
 * available aggregator with the expectation that this will spread load around
 * and minimize the likelihood of becoming corked on a single bad aggregator.
 */
caConfigService.prototype.pickAggregator = function ()
{
	var hostname, aggrs, aggr, rand;

	aggrs = [];

	for (hostname in this.cfg_aggrs) {
		aggr = this.cfg_aggrs[hostname];

		if (aggr.cag_ninsts >= cfg_agg_maxinsts)
			continue;

		/*
		 * We may have a record for this aggregator without any of the
		 * details if it's being used to aggregate an instrumentation we
		 * restored from the stash but we haven't yet actually heard
		 * from it.  In that case, we'll re-enable the aggregator when
		 * we hear from it next.
		 */
		if (!aggr.cag_routekey)
			continue;

		aggrs.push(aggr);
	}

	if (aggrs.length === 0)
		return (undefined);

	rand = Math.floor(Math.random() * aggrs.length);
	return (aggrs[rand]);
};

caConfigService.prototype.instnValidateScope = function (scopeid)
{
	var ninstns;

	if (scopeid === undefined)
		return;

	/*
	 * Customer requests require that MAPI be configured.
	 */
	if (!this.cfg_mapi)
		throw (new caError(ECA_REMOTE, null, 'MAPI is not configured'));

	/*
	 * For customer requests we impose a limit on the number of active
	 * instrumentations at any given time to prevent individual customers
	 * from over-taxing our infrastructure.  Global instrumentations (which
	 * can only be created by administrators) have no such limits.
	 */
	ninstns = Object.keys(this.cfg_custs[scopeid]['insts']).length;
	ASSERT(ninstns <= cfg_instn_max_peruser);
	if (ninstns == cfg_instn_max_peruser) {
		this.cfg_log.warn('user %s attempted to exceed max # ' +
		    'of instrumentations allowed', scopeid);
		throw (new caValidationError(caSprintf(
		    'only %d instrumentations allowed',
		    cfg_instn_max_peruser)));
	}
};

caConfigService.prototype.instnValidateProps = function (props, pset, scopeid)
{
	var metric, fields, mfields, fieldarities, arity, ii;

	/*
	 * "module" and "stat" are always required.
	 */
	if (!props['module'])
		throw (new caInvalidFieldError('module'));

	if (!props['stat'])
		throw (new caInvalidFieldError('stat'));

	/*
	 * Check whether the base metric exists in the user's profile.  If not,
	 * we act just as though it didn't exist at all.
	 */
	metric = pset.baseMetric(props['module'], props['stat']);
	if (!metric)
		throw (new caInvalidFieldError('module.stat',
		    props['module'] + '.' + props['stat'],
		    'not a valid module/stat pair'));

	props['value-scope'] = this.cfg_metadata.metricInterval(
	    props['module'], props['stat']);

	/*
	 * "decomposition" is optional.  If it comes in as a string, convert it
	 * to an empty array to match our canonical form.
	 */
	if (!props['decomposition'] || props['decomposition'] === '')
		props['decomposition'] = [];
	else if (typeof (props['decomposition']) == typeof (''))
		props['decomposition'] = props['decomposition'].split(',');

	/*
	 * "predicate" is also optional.  If it comes in as a string, it should
	 * be reparsed, since the canonical representation is always an object
	 * but clients may pass in a JSON (string) representation.
	 */
	if (!props['predicate'])
		props['predicate'] = {};
	else if (typeof (props['predicate']) == typeof ('')) {
		try {
			props['predicate'] = JSON.parse(props['predicate']);
		} catch (ex) {
			throw (new caInvalidFieldError('predicate',
			    props['predicate'], 'invalid JSON: ' +
			    ex.message));
		}
	}

	/*
	 * Validate the predicate syntactically. We do this before validating
	 * whether the decomposition and predicate use valid fields because the
	 * predicate must have correct form to even extract the fields from it.
	 */
	mod_capred.caPredValidateSyntax(props['predicate']);

	/*
	 * Now that we've got a valid base metric and predicate structure, check
	 * that the user-specified fields are valid.
	 */
	mfields = metric.fields();
	fieldarities = {};
	for (ii = 0; ii < mfields.length; ii++)
		fieldarities[mfields[ii]] =
		    this.cfg_metadata.fieldArity(mfields[ii]);
	fields = props['decomposition'].concat(
	    mod_capred.caPredFields(props['predicate']));
	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in fieldarities))
			throw (new caInvalidFieldError('field',
			    fields[ii], 'no such field for specified metric'));
	}

	mod_capred.caPredValidateSemantics(fieldarities, props['predicate']);

	/*
	 * Validate the decomposition fields and fill in the value-* members.
	 */
	arity = caInstArity(fieldarities, props['decomposition']);
	props['value-dimension'] = arity['dimension'];
	props['value-arity'] = arity['arity'];

	props['crtime'] = new Date().getTime();

	/*
	 * Validate the "granularity" property, which must be a positive integer
	 * that's either 1 or divisible by the minimum granularity that's
	 * greater than one.
	 */
	if (!('granularity' in props))
		props['granularity'] = cfg_granularity_default;

	props['granularity'] = parseInt(props['granularity'], 10);

	if (isNaN(props['granularity']) || props['granularity'] < 1)
		throw (new caInvalidFieldError('granularity',
		    props['granularity'], 'not a positive integer'));

	if (props['granularity'] != 1 &&
	    props['granularity'] % mod_ca.ca_granularity_min != 0)
		throw (new caInvalidFieldError('granularity',
		    props['granularity'], 'must be divisible by %d',
		    mod_ca.ca_granularity_min));

	/*
	 * Fill in available transformations.
	 */
	props['transformations'] = caInstTransformations(fieldarities,
	    this.cfg_xforms, props);

	/*
	 * Validate the optional mutable fields.
	 */
	if (!('enabled' in props))
		props['enabled'] = 'true';
	if (!('retention-time' in props))
		props['retention-time'] = cfg_retain_default;
	if (!('idle-max' in props))
		props['idle-max'] = cfg_idle_max_default;
	if (!('persist-data' in props))
		props['persist-data'] = 'false';

	caInstValidateMutableFields(props, scopeid === undefined);
	return (props);
};

/*
 * Saves a debug message into the internal debug ringbuffer.  If "dolog" is
 * specified, the message is also saved to the persistent log.  Relatively rare
 * messages (like administrative events) are generally saved persistently while
 * potentially frequent message (like state changes) are only saved into the
 * debug log.
 */
caConfigService.prototype.instnDbg = function (instn, dolog)
{
	var args, str;

	args = Array.prototype.slice.call(arguments, 2);
	str = caSprintf('instn "%s": %s', instn.cfi_fqid,
	    caSprintf.apply(null, args));
	this.cfg_dbg.dbg(str);

	if (dolog)
		this.cfg_log.info('%s', str);
};

/*
 * Processes any outstanding tasks on this instrumentation's pending list.
 */
caConfigService.prototype.instnRun = function (instn)
{
	var svc = this;

	setTimeout(function () {
		var task;

		if (instn.cfi_tasks.length === 0 || instn.cfi_task_pending)
			return;

		mod_assert.ok(!svc.cfg_stopped);
		mod_assert.ok(!svc.cfg_ondone);
		task = instn.cfi_tasks.shift();
		instn.cfi_task_pending = true;
		svc.cfg_npending++;
		svc.instnDbg(instn, false, 'task %s: start', task.func.name);
		task.func.call(svc, instn, function (err) {
			svc.instnDbg(instn, false, 'task %s: done',
			    task.func.name);
			svc.cfg_npending--;
			instn.cfi_task_pending = false;

			if (task.callback)
				task.callback(err);

			if (svc.cfg_ondone) {
				svc.instnDbg(instn, false,
				    'finished last pending task');
				svc.cfg_ondone();
			}

			if (instn.cfi_fqid in svc.cfg_dead &&
			    instn.cfi_tasks.length === 0)
				delete (svc.cfg_dead[instn.cfi_fqid]);
			else
				svc.instnRun(instn);
		});
	}, 0);
};

/*
 * Enqueues a new task for this instrumentation.
 */
caConfigService.prototype.instnTask = function (instn, func, callback)
{
	if (this.cfg_stopped) {
		this.instnDbg(instn, true, 'dropping task %s (stopped)',
		    func.name);
		return;
	}

	instn.cfi_tasks.push({ func: func, callback: callback });
	this.instnDbg(instn, false, 'enqueued task %s', func.name);
	this.instnRun(instn);
};

/*
 * Aborts all tasks in the pending list.
 */
caConfigService.prototype.instnTasksFlush = function (instn)
{
	/*
	 * Cancel the existing tasks, ignore any that come in while we're doing
	 * that, and then clear the whole task queue.
	 */
	instn.cfi_tasks.forEach(function (task) {
		if (task.callback)
			task.callback(new caError(ECA_INTR));
	});

	instn.cfi_tasks = [];
	this.instnDbg(instn, false, 'flushed task queue');
};

/*
 * Generates a stash "put" request to save the configuration for an
 * instrumentation with the specified fqid and properties.
 */
caConfigService.prototype.instnSaveRequest = function (scopeid, instnid, props,
    zonesbyhost, aggregator)
{
	var metadata, saveobj;

	metadata = {
	    cfg_modified: new Date(),
	    cfg_creator: this.cfg_sysinfo,
	    cfg_vers_major: cfg_stash_vers_major,
	    cfg_vers_minor: cfg_stash_vers_minor
	};

	saveobj = {
	    scope_id: scopeid,
	    instn_id: instnid,
	    properties: props
	};

	if (zonesbyhost)
		saveobj['zonesbyhost'] = zonesbyhost;

	if (aggregator)
		saveobj['aggregator'] = aggregator;

	return ({
	    bucket: 'ca.config.instn.' + mod_ca.caQualifiedId(scopeid, instnid),
	    metadata: metadata,
	    data: JSON.stringify(saveobj)
	});
};

/*
 * Saves the given instrumentation's state to the stash, invoking callback() on
 * complete.  This callback is for notification only, not error reporting.
 */
caConfigService.prototype.instnTaskSave = function instnTaskSave(instn,
    callback, props)
{
	var svc, func, rq;

	this.instnDbg(instn, false, 'task save start');

	if (!props)
		props = instn.cfi_props;

	if (instn.cfi_deleted) {
		func = this.cfg_cap.cmdDataDelete.bind(this.cfg_cap);
		rq = { bucket: 'ca.config.instn.' + instn.cfi_fqid };
	} else {
		func = this.cfg_cap.cmdDataPut.bind(this.cfg_cap);
		rq = this.instnSaveRequest(instn.cfi_scopeid, instn.cfi_instnid,
		    props, instn.cfi_zonesbyhost, instn.cfi_aggr !== undefined ?
		    instn.cfi_aggr.cag_hostname : undefined);
	}

	svc = this;

	func(mod_cap.ca_amqp_key_stash, 10000, [ rq ], function (err) {
		if (err)
			svc.instnDbg(instn, true, 'task save failed: %r', err);
		else
			svc.instnDbg(instn, true, 'task save done');

		callback(err);
	});
};

/*
 * Propagates saved property changes (or even instrumentation existence, which
 * is the same thing) to the assigned aggregator.
 */
caConfigService.prototype.instnTaskAggrUpdate = function instnTaskAggrUpdate
    (instn, callback)
{
	var svc, aggrkey, instnkey;

	svc = this;
	aggrkey = instn.cfi_aggr.cag_routekey;
	instnkey = mod_cap.caRouteKeyForInst(instn.cfi_fqid);

	if (!aggrkey) {
		/*
		 * This aggregator is not yet online.  We'll try again later
		 * when we hear from it.
		 */
		this.instnDbg(instn, true, 'aggr update skipped (not online)');
		callback();
		return;
	}

	this.instnDbg(instn, false, 'aggr update "%s" start', aggrkey);

	this.cfg_cap.cmdEnableAgg(aggrkey, instn.cfi_fqid, instnkey,
	    instn.cfi_props, cfg_timeout_aggenable, function (err) {
		if (err) {
			/*
			 * We don't bother retrying.  Most of the time the
			 * problem was that the aggregator was down, in which
			 * case we'll poke it when it comes back up.  If it was
			 * any other problem, there's no reason to believe
			 * trying again will work.
			 */
			svc.instnDbg(instn, true, 'aggr update "%s" failed: %r',
			    aggrkey, err);
			callback(err);
			return;
		}

		svc.instnDbg(instn, true, 'aggr update "%s" done', aggrkey);
		callback();
	    });
};

/*
 * Disables an instrumentation on an aggregator.
 */
caConfigService.prototype.instnTaskAggrDisable = function instnTaskAggrDisable
    (instn, callback)
{
	var svc, aggrkey;

	svc = this;
	aggrkey = instn.cfi_aggr.cag_routekey;

	if (!aggrkey) {
		/*
		 * This aggregator is not yet online.  We don't have to do
		 * anything since it doesn't know about this instn.
		 */
		this.instnDbg(instn, true, 'aggr disable skipped (not online)');
		callback();
		return;
	}

	this.instnDbg(instn, false, 'aggr disable "%s" start', aggrkey);

	this.cfg_cap.cmdDisableAgg(aggrkey, instn.cfi_fqid,
	    cfg_timeout_aggenable, function (err) {
		if (err) {
			svc.instnDbg(instn, true, 'aggr disable "%s" ' +
			    'failed: %r', aggrkey, err);
			svc.instnTask(instn, svc.instnTaskAggrDisable);
			callback(err);
			return;
		}

		svc.instnDbg(instn, true, 'aggr disable "%s" done', aggrkey);
		callback();
	    });
};

/*
 * Updates the list of zones and hosts for this customer from MAPI.  This
 * function is asynchronous, and only one request may be outstanding at a time.
 */
caConfigService.prototype.instnTaskZonesUpdate = function instnTaskZonesUpdate
    (instn, callback)
{
	var svc = this;

	/*
	 * For global instrumentations, there's no "zonesbyhost" because we're
	 * instrumenting everything.
	 */
	if (instn.cfi_scopeid === undefined) {
		delete (instn.cfi_zonesbyhost);
		this.instnDbg(instn, false, 'zone list update not needed');
		this.instnTask(instn, this.instnTaskInstrsUpdate);
		return (callback());
	}

	this.instnDbg(instn, false, 'zone list update start');

	/*
	 * We checked whether MAPI was configured when this instrumentation was
	 * created.  Although it's possible that it was configured then but
	 * isn't now, that can't happen in production because MAPI is always
	 * configured in production.
	 */
	mod_assert.ok(this.cfg_mapi, 'MAPI is not configured');

	return (this.cfg_mapi.listContainers(instn.cfi_scopeid,
	    function (err, zonesbyhost) {
		if (err) {
			/*
			 * On failure, we leave our existing state alone and
			 * simply mark that we're no longer trying to update.
			 */
			svc.instnDbg(instn, true,
			    'zone list update failed: %r', err);
			return (callback());
		}

		svc.instnTask(instn, svc.instnTaskInstrsUpdate);
		svc.instnDbg(instn, true, 'zone list update done');
		instn.cfi_zonesbyhost = zonesbyhost;
		return (callback());
	    }));
};

caConfigService.prototype.instnTaskInstrsUpdate = function instnTaskInstrsUpdate
    (instn, callback)
{
	var metric, fieldset, fields, hosts, hostname, nsources, funcs, func;
	var svc = this;

	this.instnDbg(instn, false, 'instrs update start');

	metric = this.cfg_metrics.baseMetric(instn.cfi_props['module'],
	    instn.cfi_props['stat']);
	fieldset = {};
	instn.cfi_props['decomposition'].forEach(
	    function (field) { fieldset[field] = true; });
	mod_capred.caPredFields(instn.cfi_props['predicate']).forEach(
	    function (field) { fieldset[field] = true; });
	fields = Object.keys(fieldset);

	hosts = instn.cfi_zonesbyhost || this.cfg_instrs;
	nsources = 0;

	for (hostname in instn.cfi_instrs)
		instn.cfi_instrs[hostname]['desired'] = false;

	for (hostname in hosts) {
		if (!instn.cfi_instrs[hostname])
			instn.cfi_instrs[hostname] = { state: false };

		instn.cfi_instrs[hostname]['desired'] = true;
		nsources++;
	}

	/*
	 * Having constructed the updated list of relevant instrumenters, see if
	 * the "nsources" property needs to be updated.
	 */
	if (instn.cfi_props['nsources'] != nsources && !instn.cfi_deleted) {
		instn.cfi_props['nsources'] = nsources;
		this.instnTask(instn, this.instnTaskAggrUpdate);
	}

	/*
	 * Finally, enable or disable instrumentation on each instrumenter.
	 */
	funcs = [];
	for (hostname in instn.cfi_instrs) {
		/*
		 * We may see a hostname reported by MAPI that has no
		 * instrumenter associated with it.  This can happen because the
		 * host doesn't support CA or because the host's instrumenter
		 * hasn't come online since the config service started.  In
		 * either case, we ignore it for now.
		 */
		if (!(hostname in this.cfg_instrs)) {
			this.instnDbg(instn, false,
			    'instr "%s" update skipped (unknown host)',
			    hostname);
			continue;
		}

		if (!(this.cfg_metrics.supports(metric, fields, hostname))) {
			this.instnDbg(instn, false, 'instr "%s" update ' +
			    'skipped (metric unsupported)', hostname);
			continue;
		}

		if (instn.cfi_instrs[hostname]['state'] ===
		    instn.cfi_instrs[hostname]['desired']) {
			this.instnDbg(instn, false, 'instr "%s" update ' +
			    'skipped (already up-to-date)', hostname);
			continue;
		}

		func = instn.cfi_instrs[hostname]['desired'] ?
		    this.instrEnable :
		    this.instrDisable;

		funcs.push(func.bind(this, instn, hostname));
	}

	/* Errors are logged by the individual functions. */
	caRunParallel(funcs, function () {
		/*
		 * We don't bother retrying here.  The most likely failure mode
		 * is that we couldn't connect to an instrumenter.  If that
		 * happens, it will contact us when it comes back, at which
		 * point we will try again to update its state.
		 */
		svc.instnDbg(instn, false, 'instrs update done');
		callback();
	});
};

caConfigService.prototype.instrEnable = function (instn, hostname, callback)
{
	var svc, instr, instnkey, zones;

	mod_assert.ok(instn.cfi_instrs[hostname]['desired']);
	mod_assert.ok(!instn.cfi_instrs[hostname]['state']);
	mod_assert.ok(hostname in this.cfg_instrs);

	svc = this;
	instr = this.cfg_instrs[hostname];

	this.instnDbg(instn, false, 'instr "%s" enable start', hostname);
	instnkey = mod_cap.caRouteKeyForInst(instn.cfi_fqid);

	if (instn.cfi_zonesbyhost) {
		mod_assert.ok(hostname in instn.cfi_zonesbyhost);
		zones = instn.cfi_zonesbyhost[hostname];
		mod_assert.ok(zones.length > 0);
	}

	return (this.cfg_cap.cmdEnableInst(instr.ins_routekey, instn.cfi_fqid,
	    instnkey, instn.cfi_props, zones, cfg_timeout_instenable,
	    function (err) {
		if (err) {
			svc.instnDbg(instn, true, 'instr "%s" enable ' +
			    'failed: %r', hostname, err);
		} else {
			svc.instnDbg(instn, true, 'instr "%s" enable done',
			    hostname);
			instn.cfi_instrs[hostname]['state'] = true;
		}

		callback(err);
	    }));
};

caConfigService.prototype.instrDisable = function (instn, hostname, callback)
{
	var svc, instr;

	mod_assert.ok(!instn.cfi_instrs[hostname]['desired']);
	mod_assert.ok(instn.cfi_instrs[hostname]['state']);
	mod_assert.ok(hostname in this.cfg_instrs);

	svc = this;
	instr = this.cfg_instrs[hostname];

	this.instnDbg(instn, false, 'instr "%s" disable start', hostname);

	return (this.cfg_cap.cmdDisableInst(instr.ins_routekey, instn.cfi_fqid,
	    cfg_timeout_instdisable, function (err) {
		if (err) {
			svc.instnDbg(instn, true, 'instr "%s" disable ' +
			    'failed: %r', hostname, err);
		} else {
			svc.instnDbg(instn, true, 'instr "%s" disable done',
			    hostname);
			delete (instn.cfi_instrs[hostname]);
		}

		callback(err);
	    }));
};

/*
 * Delete an instrumentation.
 */
caConfigService.prototype.instnTaskDelete = function instnTaskDelete
    (instn, callback)
{
	var svc = this;

	this.instnDbg(instn, false, 'delete start');

	mod_assert.ok(!instn.cfi_deleted);
	instn.cfi_deleted = true;
	this.instnTaskSave(instn, function (err) {
		var scope;

		if (err) {
			instn.cfi_deleted = false;
			svc.instnDbg(instn, true, 'delete failed: %r', err);
			return (callback(err));
		}

		svc.instnDbg(instn, true, 'delete done');
		instn.cfi_aggr.cag_ninsts--;

		instn.cfi_zonesbyhost = {}; /* clear all instrs */
		svc.instnTasksFlush(instn);
		svc.instnTask(instn, svc.instnTaskAggrDisable);
		svc.instnTask(instn, svc.instnTaskInstrsUpdate);

		scope = instn.cfi_scopeid === undefined ?
		    svc.cfg_globals : svc.cfg_custs[instn.cfi_scopeid]['insts'];

		mod_assert.ok(instn.cfi_fqid in scope);
		mod_assert.equal(svc.cfg_instns[instn.cfi_fqid], instn);
		mod_assert.ok(instn.cfi_fqid in svc.cfg_last);
		mod_assert.ok(!(instn.cfi_fqid in svc.cfg_dead));

		delete (scope[instn.cfi_fqid]);
		delete (svc.cfg_instns[instn.cfi_fqid]);
		delete (svc.cfg_last[instn.cfi_fqid]);
		svc.cfg_dead[instn.cfi_fqid] = instn;

		return (callback());
	});
};

/*
 * Retrieves an object describing the current service state for debugging and
 * monitoring.  Values include configuration constants (like remote service
 * hostnames), tunables, internal state counters, etc.  The following arguments
 * must be specified:
 *
 *	callback	Invoked upon completion with one argument representing
 *			the current status.  The callback may be invoked
 *			synchronously if "recurse" is false.
 *
 *	recurse		Send AMQP status messages to other components in the
 *			system (instrumenters and aggregators) to retrieve their
 *			status as well.  If any of these commands fail or
 *			time out, the corresponding entries will contain an
 *			'error' describing what happened.
 *
 *	timeout		When recurse is true, this number denotes the maximum
 *			time to wait (in milliseconds) for any the status
 *			requests to other components before timing out.
 */
caConfigService.prototype.status = function (callback, recurse, timeout)
{
	var ret, key, obj;
	var nrequests, checkdone, doamqp;
	var start = new Date().getTime();

	checkdone = function () {
		ASSERT(nrequests > 0);
		if (--nrequests !== 0)
			return;

		ret['request_latency'] = new Date().getTime() - start;
		callback(ret);
	};

	nrequests = 1;
	ret = {};
	ret['heap'] = process.memoryUsage();
	ret['http'] = this.cfg_http.info();
	ret['amqp_cap'] = this.cfg_cap.info();
	ret['sysinfo'] = this.cfg_sysinfo;
	ret['started'] = this.cfg_start;
	ret['uptime'] = start - this.cfg_start;

	ret['cfg_http_port'] = this.cfg_http_port;
	ret['cfg_instn_max_peruser'] = this.cfg_instn_max_peruser;
	ret['cfg_reaper_interval'] = this.cfg_reaper_interval;
	ret['cfg_reaper_last'] = this.cfg_reaper_last;
	ret['cfg_metadata'] = this.cfg_metadata;

	ret['cfg_aggregators'] = {};
	for (key in this.cfg_aggrs) {
		obj = this.cfg_aggrs[key];
		ret['cfg_aggregators'][key] = {
		    hostname: obj.cag_hostname,
		    routekey: obj.cag_routekey,
		    http_port: obj.cag_http_port,
		    transformations: obj.cag_transformations,
		    ninsts: obj.cag_ninsts
		};
	}

	ret['cfg_instrumenters'] = {};
	for (key in this.cfg_instrs) {
		obj = this.cfg_instrs[key];

		ret['cfg_instrumenters'][key] = {
		    hostname: obj.ins_hostname,
		    routekey: obj.ins_routekey
		};
	}

	ret['cfg_insts'] = {};
	for (key in this.cfg_instns) {
		obj = this.cfg_instns[key];

		ret['cfg_insts'][key] = caDeepCopy(obj.cfi_props);
		ret['cfg_insts'][key]['aggregator'] =
		    obj.cfi_aggr.cag_hostname;
		ret['cfg_insts'][key]['custid'] = obj.cfi_scopeid;
	}

	ret['instn-scopes'] = {};
	ret['instn-scopes']['global'] = Object.keys(this.cfg_globals);
	for (key in this.cfg_custs)
		ret['instn-scopes']['cust:' + key] =
		    Object.keys(this.cfg_custs[key]['insts']);

	ret['cfg_dbg'] = this.cfg_dbg.info();

	if (!recurse)
		return (checkdone());

	/*
	 * The user wants information about each related service.  We make a
	 * subrequest to each one and store the results in our return value.
	 */
	ASSERT(timeout && typeof (timeout) == typeof (0));
	doamqp = function (type, hostname) {
		return (function (err, result) {
			if (err)
				ret[type][hostname] = { error: err };
			else
				ret[type][hostname] = result.s_status;

			checkdone();
		});
	};

	ret['aggregators'] = {};
	for (key in this.cfg_aggrs) {
		obj = this.cfg_aggrs[key];
		ret['aggregators'][key] = { error: 'timed out' };
		if (!obj.cag_routekey)
			continue;
		nrequests++;
		this.cfg_cap.cmdStatus(obj.cag_routekey, timeout,
		    doamqp('aggregators', key));
	}

	ret['instrumenters'] = {};
	for (key in this.cfg_instrs) {
		obj = this.cfg_instrs[key];
		ret['instrumenters'][key] = { error: 'timed out' };
		if (!obj.ins_routekey)
			continue;
		nrequests++;
		this.cfg_cap.cmdStatus(obj.ins_routekey, timeout,
		    doamqp('instrumenters', key));
	}

	return (checkdone());
};

/*
 * Given a the field types for a metric and the 'decomposition' fields of a
 * potential instrumentation, validate the decomposition fields and return the
 * "arity" of one of the resulting data points.  This is specified as an object
 * with the following member:
 *
 *	dimension	Describes the dimensionality of each datum as an
 *			integer.  For simple scalar metrics, the dimension is 1.
 *			The dimensionality increases with each decomposition.
 *
 *	arity		Describes the datum itself.  If dimension is 1, then
 *			type is always 'scalar'.  If any decompositions use a
 *			numeric field (e.g., latency), then type is
 *			'numeric-decomposition'.  Otherwise, type is
 *			'discrete-decomposition'.
 *
 * Combined, this information allows clients to know whether to visualize the
 * result as a simple line graph, a line graph with multiple series, or a
 * heatmap.  For examples:
 *
 *	METRIC				DIM	type		VISUAL
 *	i/o ops				1	scalar		line
 *	i/o ops by disk			2	discrete 	multi-line
 *	i/o ops by latency		2	numeric		heatmap
 *	i/o ops by latency and disk	3	numeric		heatmap
 */
function caInstArity(fieldarities, decomp)
{
	var field, type, ctype, ii;
	var ndiscrete = 0;
	var nnumeric = 0;

	type = decomp.length === 0 ? mod_ca.ca_arity_scalar :
	    mod_ca.ca_arity_discrete;

	for (ii = 0; ii < decomp.length; ii++) {
		field = decomp[ii];
		ASSERT(field in fieldarities);
		ctype = fieldarities[field];

		if (ctype == mod_ca.ca_field_arity_numeric) {
			type = mod_ca.ca_arity_numeric;
			nnumeric++;
		} else {
			ndiscrete++;
		}
	}

	if (ndiscrete > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one discrete decomposition specified'));

	if (nnumeric > 1)
		throw (new caInvalidFieldError('decomposition', decomp,
		    'more than one numeric decomposition specified'));

	return ({ dimension: decomp.length + 1, arity: type });
}

/*
 * Validates the mutable fields of an instrumentation.
 * XXX convert caHttpParam to use caInvalidFieldError and make this function
 * much simpler.
 */
function caInstValidateMutableFields(props, privileged)
{
	var retain, idle;

	if ('enabled' in props) {
		if (props['enabled'] !== 'true' && props['enabled'] !== true)
			throw (new caInvalidFieldError('enabled',
			    props['enabled'], 'unsupported value'));

		props['enabled'] = true;
	}

	if ('retention-time' in props) {
		retain = parseInt(props['retention-time'], 10);

		if (isNaN(retain))
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'not a number'));

		if (retain < cfg_retain_min)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'], 'minimum is %s',
			    cfg_retain_min));

		if (retain / props['granularity'] > cfg_datapoints_max)
			throw (new caInvalidFieldError('retention-time',
			    props['retention-time'],
			    'maximum for granularity "%s" is %s',
			    props['granularity'], cfg_datapoints_max *
			    props['granularity']));

		props['retention-time'] = retain;
	}

	if ('idle-max' in props) {
		idle = parseInt(props['idle-max'], 10);

		if (isNaN(idle))
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'not a number'));

		if (idle < cfg_idle_max_min)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'minimum is %s',
			    cfg_idle_max_min));

		if (idle > cfg_idle_max_max)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'maximum is %s',
			    cfg_idle_max_max));

		if (idle === 0 && !privileged)
			throw (new caInvalidFieldError('idle-max',
			    props['idle-max'], 'zero not allowed'));

		props['idle-max'] = idle;
	}

	if ('persist-data' in props) {
		if (props['persist-data'] === 'true' ||
		    props['persist-data'] === true)
			props['persist-data'] = true;
		else if (props['persist-data'] === 'false' ||
		    props['persist-data'] === false)
			props['persist-data'] = false;
		else
			throw (new caInvalidFieldError('persist-data',
			    props['persist-data'], 'must be a boolean'));
	}

	return ([ 'enabled', 'retention-time', 'idle-max', 'persist-data' ]);
}

/*
 * Fill in available transformations based on the specified metric and the
 * instrumentation defined by "props".
 */
function caInstTransformations(fieldarities, transformations, props)
{
	var ret = {};
	var ii, tname, tfields, fname, transform;

	for (tname in transformations) {
		transform = transformations[tname];
		tfields = transform['fields'];
		for (ii = 0; ii < props['decomposition'].length; ii++) {
			fname = props['decomposition'][ii];
			if (caArrayContains(tfields, fname) && !(tname in ret))
				ret[tname] = transform;
		}
	}

	return (ret);
}


/*
 * Given properties as specified by a validated user request or persistent
 * store, construct a canonical "props" object by filling in properties whose
 * values are derived from other properties (like "uri", which is derived from
 * the id).
 */
function caNormalizeProperties(baseuri, scopeid, instnid, props)
{
	var fields, defaults, ii, uris, uri;

	var nprops = {};

	fields = [ 'module', 'stat', 'predicate', 'decomposition',
	    'value-dimension', 'value-arity', 'enabled', 'retention-time',
	    'idle-max', 'transformations', 'nsources', 'granularity',
	    'persist-data', 'crtime', 'value-scope' ];

	defaults = {
	    'crtime': 0,
	    'persist-data': false,
	    'value-scope': 'interval',
	    'nsources': 0
	};

	/*
	 * Load the main properties.
	 */
	for (ii = 0; ii < fields.length; ii++) {
		if (!(fields[ii] in props)) {
			ASSERT(fields[ii] in defaults);
			nprops[fields[ii]] = defaults[fields[ii]];
			continue;
		}

		nprops[fields[ii]] = props[fields[ii]];
	}

	/*
	 * Construct the URI and ID properties, which are derived from the
	 * others.
	 */
	uri = caSprintf('%s%s%s/%s', baseuri,
	    (scopeid ? cfg_http_uri_cust + '/' + scopeid : ''),
	    cfg_http_uri_inst, instnid);
	nprops['uri'] = uri;
	nprops['id'] = instnid.toString();

	uris = [];
	if (nprops['value-arity'] == mod_ca.ca_arity_numeric) {
		uris.push({
		    uri: uri + cfg_http_uri_heatmap_image,
		    name: 'value_heatmap'
		});
		uris.push({
		    uri: uri + cfg_http_uri_heatmap_details,
		    name: 'details_heatmap'
		});
	}

	uris.push({ uri: uri + cfg_http_uri_raw, name: 'value_raw' });
	nprops['uris'] = uris;
	return (nprops);
}
