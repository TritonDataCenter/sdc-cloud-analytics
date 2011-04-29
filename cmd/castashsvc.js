/*
 * castashsvc: Cloud Analytics Stash (Persistence) service
 */

var mod_svcpersist = require('../lib/ca/ca-svc-persist');
var mod_dbg = require('../lib/ca/ca-dbg');

var cs_svc;

function main()
{
	mod_dbg.caEnablePanicOnCrash();
	cs_svc = new mod_svcpersist.caPersistenceService(
	    process.argv.slice(2));
	caDbg.set('service', cs_svc);
	cs_svc.start();
}

main();
