#!/bin/bash

if [[ `hostname` = 'bldzone2.joyent.us' ]]; then
  ssh bamboo@10.2.0.190 mkdir -p $PUBLISH_LOCATION
  scp build/pkg/cabase.tar.gz    "bamboo@10.2.0.190:$PUBLISH_LOCATION/$CABASE_PKG"
  scp build/pkg/cainstsvc.tar.gz "bamboo@10.2.0.190:$PUBLISH_LOCATION/$CAINSTSVC_PKG"
else
  echo "Not publishing because not on bldzone2.joyent.us (bh1-smartosbuild)"
fi
