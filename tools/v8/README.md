v8tools
=======

This module contains a collection of *development* tools for observing the V8
JavaScript VM, both at runtime and postmortem.  These tools are still unstable.
They depend heavily on V8 implementation details.

mdb dmod
--------

The "mdb" directory contains the source for an mdb(1M) debugger module that
provides the following commands:

`addr::jsframe [-v]` prints a one-line summary for the stack frame referenced by
frame pointer `addr`.  The summary includes the function name and the file name
and line number (if available) where the function was defined.  With `-v`, this
command prints details about how it got this information.

`::jsstack` iterates the stack frames for the main thread and invokes
`::jsframe` on each one.

`addr::jsprint <class>` takes a heap pointer `addr` and prints it as an object
of type `class`.  This prints all of the fields of the given object, but only a
few classes are currently supported.

`addr::jsstr [-v]` takes a pointer to an ASCII String object on the heap and
prints out the contents of the String, assembling it from its component parts.
With `-v`, this command prints the component strings.

`addr::jstype` prints the InstanceType of heap object `addr`.  For SMI objects,
the actual value is also printed.

`::jstypes` prints all known InstanceTypes.


dtrace ustack helper
--------------------

The "dtrace" directory contains the source for a DTrace ustack helper, which
resolves JavaScript function names from a native stack trace.  With the helper
linked into a V8 binary (like "node"), you can use the `jstack()` DTrace action
to gather stack traces with JavaScript function names.

For more details, see dtrace/node_helper.d.
