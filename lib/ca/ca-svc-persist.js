/*
 * ca-svc-persist.js: implementation of persistence service
 */

var mod_ca = require('./ca-common');
var mod_calog = require('./ca-log');
var mod_cap = require('./ca-amqp-cap');
var mod_capersist = require('./ca-persist');

var ps_name = 'persistsvc';	/* component name */
var ps_vers = '0.0';		/* component version */

/* XXX caller needs to set caDbg and PanicOnCrash */
function caPersistenceService(argv)
{
	this.ps_name = ps_name;
	this.ps_vers = ps_vers;
	this.ps_sysinfo = mod_ca.caSysinfo(this.ps_name, this.ps_vers);
	this.ps_log = new mod_calog.caLog({ out: process.stdout });
	this.ps_stash = new mod_capersist.caStash(this.ps_log, this.ps_sysinfo);
	this.ps_queue = mod_cap.cap_amqp_key_base_persist +
	    this.ps_sysinfo.ca_hostname;
	this.ps_cap = new mod_cap.capAmqpCap({
	    /* XXX dbglog contingent on argv */
	    keepalive: true,
	    log: this.ps_log,
	    queue: this.ps_queue,
	    sysinfo: this.ps_sysinfo
	});

	this.ps_cap.bind(mod_cap.ca_amqp_key_all);
	this.ps_cap.bind(mod_cap.ca_amqp_key_persist);
	/* XXX subscribe to appropriate AMQP messages */
	/* XXX continue copying from instrumenter service */
}

caPersistenceService.prototype.start = function (start)
{

};

caPersistenceService.prototype.stop = function (callback)
{

};
