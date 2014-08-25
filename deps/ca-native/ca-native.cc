/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright (c) 2014, Joyent, Inc.
 */

#include <v8.h>
#include <node.h>
#include <zone.h>
#include <errno.h>

using namespace v8;

Handle<Value> call_zonenamebyid(const Arguments& args)
{
	char buf[ZONENAME_MAX];
	zoneid_t zid;
	HandleScope scope;

	if (args.Length() != 1 || !args[0]->IsInt32())
		return (ThrowException(node::ErrnoException(EINVAL)));

	zid = args[0]->Int32Value();
	if (getzonenamebyid(zid, buf, sizeof (buf)) < 0)
		return (ThrowException(node::ErrnoException(errno)));

	return (scope.Close(String::New(buf)));
}

extern "C" void
init (Handle<Object> target) 
{
	HandleScope scope;
	Local<FunctionTemplate> templ =
	    FunctionTemplate::New(call_zonenamebyid);

	target->Set(String::NewSymbol("zoneNameById"), templ->GetFunction());
}
