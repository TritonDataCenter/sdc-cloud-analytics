#!/usr/bin/bash

set -o xtrace

function fatal
{
	echo "${npm_package_name} postdeactivate: fatal error: $*"
	exit 1
}

svc=${npm_package_name}
manifest=${npm_config_smfdir}/${svc}.xml
basefmri=$(svccfg inventory ${manifest} | grep ':@@INSTANCE_NAME' | \
    sed -e 's#:@.*##')
[[ -n $basefmri ]] || fatal "no basefmri found"

for fmri in $(svcs -H -ofmri $basefmri); do
	echo "found service $fmri"
	svcadm disable -s $fmri || fatal "could not disable $fmri"
	svccfg delete $fmri || fatal "could not delete $fmri"
done

rm $manifest || fatal "could not delete $manifest"

exit 0
