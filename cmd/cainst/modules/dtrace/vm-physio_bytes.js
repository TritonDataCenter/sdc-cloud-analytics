/*
 * DTrace metric for I/O operations.
 * Note this should be replaced by a kstat when it is available.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'vm',
    stat: 'physio_bytes',
    fields: [ 'hostname', 'zonename', 'optype' ],
    metad: {
	probedesc: [ {
	    probes: [ 'sdt:::zvol-uio-start' ],
	    aggregate: {
		optype: 'sum(((uio_t *)arg1)->uio_resid)',
		hostname: 'sum(((uio_t *)arg1)->uio_resid)',
		zonename: 'sum(((uio_t *)arg1)->uio_resid)',
		default: 'sum(((uio_t *)arg1)->uio_resid)'
	    },
	    transforms: {
		optype: 'arg2 != 1 ? "read" : "write")',
		hostname: '"' + mod_ca.caSysinfo().ca_hostname + '"',
		zonename: 'zonename'
	    }
	} ]
    }
};

exports.cadMetricDesc = desc;
