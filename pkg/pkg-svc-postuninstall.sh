#!/usr/bin/bash

set -o xtrace

function fatal
{
	echo "${npm_package_name} postdeactivate: fatal error: $*"
	exit 1
}

svc=${npm_package_name}
[[ -n $svc ]] || fatal "no svc found"

for fmri in $(svcs -H -ofmri $svc); do
	echo "found service $fmri"
	svcadm disable -s $fmri || fatal "could not disable $fmri"
	svccfg delete $fmri || fatal "could not delete $fmri"
done

if [[ -n $npm_config_smfdir ]]; then
	rm -f ${npm_config_smfdir}/${svc}*.xml || fatal "could not delete manifest"
fi

exit 0
