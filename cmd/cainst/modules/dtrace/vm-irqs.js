/*
 * DTrace metric to sample on-CPU VM threads.
 */
var mod_ca = require('../../../../lib/ca/ca-common');

var desc = {
    module: 'vm',
    stat: 'irqs',
    fields: [ 'hostname', 'zonename', 'subsecond', 'irqvector' ],
    metad: {
	probedesc: [
	    {
		probes: [ 'sdt:::kvm-inj-virq' ],
		aggregate: {
			default: 'count()',
			hostname: 'count()',
			zonename: 'count()',
			subsecond: 'lquantize(($0 % 1000000000) / 1000000, ' +
			    '0, 1000, 10)',
			irqvector: 'count()'
		},
		transforms: {
			hostname:
			    '"' + mod_ca.caSysinfo().ca_hostname + '"',
			zonename: 'zonename',
			subsecond: 'timestamp',
			irqvector: 'lltostr(arg0 & 0xff, 16)'
		}
	    }
	]
    }
};

exports.cadMetricDesc = desc;
