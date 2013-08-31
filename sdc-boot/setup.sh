#!/usr/bin/bash
#
# Copyright (c) 2013 Joyent Inc., All rights reserved.
#

export PS4='[\D{%FT%TZ}] ${BASH_SOURCE}:${LINENO}: ${FUNCNAME[0]:+${FUNCNAME[0]}(): }'
set -o xtrace

PATH=/opt/local/bin:/opt/local/sbin:/usr/bin:/usr/sbin

role=ca
app_name=$role

CONFIG_AGENT_LOCAL_MANIFESTS_DIRS=/opt/smartdc/${role}

# Source this to include the fatal() function
source /opt/smartdc/sdc-boot/lib/util.sh
sdc_common_setup

# Cookie to identify this as a SmartDC zone and its role
mkdir -p /var/smartdc/ca
mkdir -p /opt/smartdc/ca-data

data_ds=`zfs list -H -oname | grep "data$"`
[ -n "$data_ds" ] && zfs set mountpoint=/var/smartdc/ca $data_ds

echo "finalizing ca zone"

/opt/smartdc/ca/cmd/cazoneinstall || fatal "cazoneinstall failed."

function cafail
{
	echo "fatal: $*" >&2
	exit 1
}

function casetprop
{
	local svc=$1 prop=$2 value=$3
	[[ -n $value ]] || cafail "no value specified for $svc $prop"
	svccfg -s $svc setprop com.joyent.ca,$prop = \
	    astring: "$value" || cafail "failed to set $svc $prop = $val"
}

function configure
{
	#
	# Update the SMF configuration to reflect this headnode's configuration.
	# We only grab the first IP for CNAPI and VMAPI.
	#
	local SAPI_METADATA CNAPI_IP VMAPI_IP CA_AMQP_HOST

	SAPI_METADATA=/opt/smartdc/etc/sapi_metadata.json

	CNAPI_IP=$(json -f $SAPI_METADATA cnapi_admin_ips)
	VMAPI_IP=$(json -f $SAPI_METADATA vmapi_admin_ips)
	CA_AMQP_HOST=$(json -f $SAPI_METADATA ca_amqp_host)

	svcadm disable -s caconfigsvc:default || \
	    cafail "failed to disable configsvc"
	casetprop caconfigsvc:default caconfig/amqp-host "$CA_AMQP_HOST"
	casetprop caconfigsvc:default caconfig/cnapi-url "http://$CNAPI_IP"
	casetprop caconfigsvc:default caconfig/vmapi-url "http://$VMAPI_IP"
	svcadm refresh caconfigsvc:default || \
	    cafail "failed to refresh configsvc"
	svcadm enable -s caconfigsvc:default || \
	    cafail "failed to re-enable configsvc"

	fmris="$(svcs -H -ofmri caaggsvc) $(svcs -H -ofmri castashsvc)"
	for fmri in $fmris; do
		svcadm disable -s $fmri || cafail "failed to disable $fmri"
		casetprop $fmri caconfig/amqp-host "$CA_AMQP_HOST"
		svcadm refresh $fmri || cafail "failed to refresh $fmri"
		svcadm enable -s $fmri || cafail "failed to re-enable $fmri"
	done
	# rm $SAPI_METADATA
}

# configure() runs only on setup unlike configure.sh which runs on every boot.
configure

# All done, run boilerplate end-of-setup
sdc_setup_complete

exit 0
