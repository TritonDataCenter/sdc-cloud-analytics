/*
 * DTrace metric for Manta tasks killed
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'mantaop',
    stat: 'tasks_killed',
    fields: [ 'hostname', 'jobid' ],
    metad: {
	probedesc: [ {
	    probes: [ 'marlin-agent*:::task-killed' ],
	    aggregate: {
		default: 'count()',
		hostname: 'count()',
		jobid: 'count()'
	    },
	    transforms: {
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		jobid: 'copyinstr(arg0)'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
