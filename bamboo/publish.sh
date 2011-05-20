#!/bin/bash

ssh bamboo@10.2.0.190 mkdir -p $PUBLISH_LOCATION
scp build/pkg/cabase.tar.gz    "bamboo@10.2.0.190:$PUBLISH_LOCATION/$CABASE_PKG"
scp build/pkg/cainstsvc.tar.gz "bamboo@10.2.0.190:$PUBLISH_LOCATION/$CAINSTSVC_PKG"
