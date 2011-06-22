# Notes on all metrics

Each metric description includes:

* **Name:** the name of the metric in the API
* **Raw metric:** what the metric itself measures.  Note that with no decompositions
  or predicates, a metric reports data for *all servers within a data center*.
* **Decompositions:** a list of fields which can be used for filtering and
  decomposition.  All metrics contain a "hostname" field, which means you can
  choose to examine only the data from a single server ("predicating") or
  breakdown the raw value by server name ("decomposition").
* **Visibility:** indicates whether the metric is available for cloud operators
  only or both operators and end users.  The "hostname" field is always hidden
  from end users.  End users are also only allowed to see data pertaining to
  their own zones and ZFS datasets.

For documentation on the various decompositions provided by metrics, see
"Fields" below.

# Metrics

## CPU-related metrics

The CPU metrics provide observability into CPU resource usage.  These metrics
allow operators to understand CPU utilization and saturation and for customers
to understand their usage of CPU resources and compare that to their limits.


### CPU: CPUs

**Name:** cpu.cpus.  
**Raw metric:** number of CPUs.  
**Decompositions:** hostname, cpu, utilization (heatmap).  
**Visibility:** operators only.  

This raw metric measures the number of CPUs, which itself may not be very
interesting.  However, the raw value can be decomposed by current utilization
and viewed as a heatmap, allowing operators to quickly see which CPUs are hot
within the datacenter or on a particular server.


### CPU: thread executions

**Name:** cpu.thread_executions.  
**Raw metric:** number of times any thread runs continuously on CPU.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, leavereason, runtime (heatmap).  
**Visibility:** operators and end users.  

This raw metric counts the number of times any thread was taken off CPU.  This
can be used to understand CPU utilization at a very fine-grained level, since
you can observe which applications are running, for how long they're running
before being kicked off CPU, and why they're being kicked off CPU.  This in turn
can help understand whether an application is actually using a lot of CPU
directly (e.g., on CPU for long periods doing computation) vs. not (e.g., on CPU
for many short bursts, then waiting for I/O).


### CPU: aggregated CPU usage

**Name:** cpu.usage.  
**Raw metric:** total amount of available CPU time used expressed as a percent of
1 CPU.  
**Decompositions:** hostname, zonename, cpumode.  
**Visibility:** operators and end users.  

This raw metric reports the percent of CPU time used as a percent of 1 CPU's
maximum possible utilization.  For example, if a system has 8 CPUs, the maximum
value for that system will be 800.  On this system, an application fully
utilizing 2 CPUs for 1 second out of 5 will have a usage of 5% (25% of CPU, 20%
of the time).  This is most useful for understanding a zone's overall CPU usage
for load management purposes.  Also, since CPU caps are defined in terms of
aggregated CPU usage, this metric can show how close a zone is to reaching its
CPU cap.

It's important to remember that many applications do not effectively utilize
multiple CPUs.  As a result, an application may be compute-bound even though
its zone is not using all available CPU resources because the application may be
maxing out a single CPU.  To investigate this behavior, see the "CPU: cpus"
metric, which shows the utilization by-cpu, or the "CPU: thread executions"
metric, which can show the reason why an application is not using more CPU.


### CPU: aggregated wait time

**Name:** cpu.waittime.  
**Raw metric:** total amount of time spent by runnable threads waiting for a CPU.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This raw metric measures the total amount of time spent by runnable threads
waiting for a CPU.  The longer the aggregated wait time, the more time threads
spent waiting for an available CPU while ready to run.  Even on relatively idle
systems, it's normal to see non-zero wait time, since there are often more
threads ready to run than CPUs.  However, persistent high wait times indicate
CPU saturation.


### CPU: 1-minute load average

**Name:** cpu.loadavg1.  
**Raw metric:** 1-minute load average.  This loosely correlates with the average
number of threads either running or runnable over the last minute.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators only.

This raw metric roughly correlates with the average number of threads ready to
run at any given time over the last minute.  In raw form or when decomposed by
hostname, load average reflects the amount of work being done on the system, as
well as how much capacity is available for more work.

Care must be taken in interpreting the by-zonename numbers.  Like the
system-wide metric, the load average for a zone reflects the average number of
that zone's threads ready to run at any given time over the last minute.
However, a high load average for a zone does not necessarily mean that zone is
contributing much load to the system.  For example, a single very active zone on
a system can inflate the load averages of other zones on the system by keeping
the CPUs busy and causing other zones' threads to have to wait for the CPU.
Within a zone, the load average should be viewed not as a measure of the system
load induced by the zone but as a measure of the system load that's impacting
the zone (which may, of course, be caused by the zone itself).

See "CPU: aggregated wait time" for another measure of CPU saturation.


## Disk-related metrics

The disk metrics provide observability into disk I/O across a datacenter.

### Disk: disks

**Name:** disk.disks.  
**Raw metric:** number of disks.  
**Decompositions:** hostname, disk, iops (heatmap), iops\_read (heatmap),
iops\_write (heatmap), bytes (heatmap), bytes\_read (heatmap), bytes\_write
(heatmap), busytime (heatmap).  
**Visibility:** operators only.  

This raw metric measures the number of disks, which itself may not be very
interesting.  However, the raw value can be decomposed by percent busy time,
number of I/O operations completed, or number of bytes transferred, and the
result viewed as a heatmap.  This allows operators to quickly identify which
disks are busy within a datacenter or on a particular server.

Since individual disks have finite limits on both data throughput and IOPS, this
metric also allows administrators to identify disks that are maxed out, which
may be limiters for application performance.


### Disk: bytes read and written

**Name:** disk.physio_bytes.  
**Raw metric:** number of bytes read or written to disk.  
**Decompositions:** hostname, disk, optype.  
**Visibility:** operators only.  

This metric measures the raw number of bytes read and/or written to disks.  This
allows operators to see whether disks are being driven to maximum throughput
(i.e. whether the workload is disk throughput-bound) as well as the
decomposition of read and write operations in the workload.


### Disk: I/O operations

**Name:** disk.physio_ops.  
**Raw metric:** number of disk I/O operations completed.  
**Decompositions:** hostname, disk, optype, size (heatmap), offset (heatmap),
latency (heatmap).  
**Visibility:** operators only.  

This raw metric measures the raw number of read and write operations completed
by disks.  This allows operators to see whether disks are being driven to
maximum IOPS throughput (i.e. whether the workload is disk IOPS-bound).

Additionally, this metric provides decompositions by size and offset, which
help operators understand the nature of the I/O workload being applied, and
a decomposition by latency which provides deep understanding of disk performance
as it affects the workload.


## Filesystem-related metrics

The filesystem metrics provide visibility for logical filesystem operations
performed by system software and applications.  This is critically important
because the filesystem is the main interface through which applications access
disks, and disks can be a major source of system latency.  However, it's very
hard to correlate filesystem operations with disk operations for a large number
of reasons:

* Filesystem read operations (including "read", "lookup", etc.) may be satisfied
  from the OS cache, in which case the disk may not need to be accessed at all.
* A single logical filesystem read may require *multiple* disk reads because the
  requested chunk is larger than disk sector size or the filesystem block size.
* Even for a single logical filesystem read that's smaller than the disk sector
  size, the filesystem may require multiple disk reads in order to read the file
  metadata (e.g., indirect blocks).  Of course, any number of these reads may be
  satisfied by the OS read cache, reducing the number that actually hit the
  disk.
* Writes to files not marked for synchronous access will generally be cached in
  the OS and written out later.  However, if the write does not change an entire
  filesystem block, the OS will need to *read* all changed blocks (and the
  associated file metadata).
* Even writes that do rewrite an entire filesystem block may require reading
  file metadata (e.g., indirect blocks).

In summary, it's very difficult to predict for a given logical filesystem
operation what disk operations will correspond to it.  However, it's also not
generally necessary.  To understand application performance, you can use these
filesystem metrics to see logical filesystem operation *latency*.  If it's low,
then disk effects are not relevant.  Only if filesystem logical operation
latency is high should disk performance be suspected.  Similarly, if disk
operation latency is high, that doesn't mean applications are actually
experiencing that latency.


### Filesystem: logical filesystem operations

**Name:** fs.logical_ops.  
**Raw metric:** number of logical filesystem operations.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, fstype, optype, latency (heatmap).  
**Visibility:** operators and end users.  

This raw metric measures the total number of logical filesystem operations,
including read, write, create, fsync, ioctl, mkdir, and many others.  The result
can be decomposed by host, zone, application, filesystem type, operation type,
and latency (as a heatmap).  This is a primary metric for understanding
application latency resulting from filesystem or disk slowness.  See the
description under "filesystem-related metrics" above.


### Filesystem: logical read/write operations

**Name:** fs.logical_rwops.  
**Raw metric:** number of logical filesystem read/write operations.  
**Decompositions:** hostname, zonename, optype.  
**Visibility:** operators and end users.  

This raw metric measures the total number of read/write operations.  Unlike the
"logical filesystem operations" metric, this metric *only* counts reads and
writes, not the various metadata operations like create, fsync, ioctl, and
others.


### Filesystem: logical bytes read/written

**Name:** fs.logical_rwbytes.  
**Raw metric:** number of logical bytes read/written.  
**Decompositions:** hostname, zonename, optype.  
**Visibility:** operators and end users.  

This raw metric measures the total number of bytes logically read and written to
the filesystem.  This metric *only* counts reads and writes, not the various
metadata operations like create, fsync, ioctl, and others.


## Memory-related metrics

The Memory metrics report physical and virtual memory used by host and zone, as
well as events related to memory use like memory reclamations and page-ins.

### Memory: resident set size

**Name:** memory.rss.  
**Raw metric:** total bytes of physical memory in use by applications.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

The resident set of an application is the amount of physical memory it's
currently using.  This metric provides that information in total, by hostname,
or by zonename.


### Memory: maximum resident set size

**Name:** memory.rss_limit.  
**Raw metric:** maximum bytes of physical memory allowed for applications.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This metric reports the system-imposed maximum resident set size in total, by
hostname, or by zonename.  See "Memory: resident set size."


### Memory: virtual memory reserved

**Name:** memory.swap.  
**Raw metric:** total bytes of virtual memory reserved by applications.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This metric measures the total amount of virtual memory reserved by
applications, optionally decomposed by hostname and zonename.  The operating
system reserves virtual memory for all memory an application allocates that's
not directly backed by the filesystem, including memory allocated with malloc()
(whether or not the memory has been used) or by privately mapped files.  Each
zone has a limit on the maximum amount of virtual memory that can be reserved.
This metric allows operators and end users to compare zone usage against that
limit.


### Memory: maximum virtual memory used

**Name:** memory.swap_limit.  
**Raw metric:** maximum bytes of virtual memory reservable by applications.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This metric reports the maximum amount of virtual memory reservable by
applications, optionally decomposed by hostname and zonename.  See "Memory:
virtual memory reserved."


### Memory: excess memory reclaimed

**Name:** memory.reclaimed_bytes.  
**Raw metric:** total bytes of memory reclaimed by the system.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This metric reports the total number of bytes of physical memory (resident set)
reclaimed by the system because a zone has exceeded its allowable resident set
size.  Non-zero values for this metric indicate that a zone is exceeding its
physical memory limit and its memory is being paged out.


### Memory: pages paged in

**Name:** memory.pageins.  
**Raw metric:** total pages of memory paged in.  
**Decompositions:** hostname, zonename.  
**Visibility:** operators and end users.  

This metric reports the total number of pages of virtual memory paged in.
Memory is paged in when it's needed by an application but is not currently in
physical memory because the zone has previously exceeded its physical memory
limit.

This metric is the flip side of excess memory reclaimed: when a zone exceeds
its physical limit, some memory is paged out, which can be observed with the
"Memory: excess memory reclaimed" metric.  When that memory is needed again,
it's paged back in, which can be observed using this metric.  In other words,
this metric shows when the zone is experiencing latency as a result of having
previously exceeded its memory limit.


## NIC-related metrics

The NIC metrics allow operators and end users to observe network activity as it
relates to physical network cards (system-wide activity) or VNICs (per-zone
activity).


### NIC: NICs

**Name:** nic.nics.  
**Raw metric:** number of physical NICs.  
**Decompositions:** hostname, nic, packets (heatmap), packets\_in (heatmap),
packets\_out (heatmap), bytes (heatmap), bytes\_in (heatmap), bytes\_out
(heatmap).  
**Visibility:** operators only.  

This raw metric measures the number of physical network cards, which itself may
not be very interesting.  However, the raw value can be decomposed by the number
of packets sent and received or the number of bytes sent and received and the
result viewed as a heatmap, allowing operators to quickly see which NICs are
busy within the datacenter or on a particular server.


### NIC: bytes sent and received

**Name:** nic.bytes.  
**Raw metric:** number of bytes sent and received over physical NICs.  
**Decompositions:** hostname, nic, direction.  
**Visibility:** operators only.  

This raw metric measures the number of bytes sent and/or received over physical
network cards, optionally decomposed by hostname, NIC, or direction.


### NIC: packets sent and received

**Name:** nic.packets.  
**Raw metric:** number of packets sent and received over physical NICs.  
**Decompositions:** hostname, nic, direction.  
**Visibility:** operators only.  

This raw metric measures the number of packets sent and/or received over
physical network cards, optionally decomposed by hostname, NIC, or direction.


### NIC: VNIC bytes sent and received

**Name:** nic.vnic_bytes.  
**Raw metric:** number of bytes sent and received over per-zone VNICs.  
**Decompositions:** hostname, zonename, direction.  
**Visibility:** operators and end users.  

This raw metric measures the number of bytes sent and/or received by a
particular zone's VNICs, optionally decomposed by hostname, zonename, or
direction.


### NIC: VNIC packets sent and received

**Name:** nic.vnic_packets.  
**Raw metric:** number of packets sent and received over per-zone VNICs.  
**Decompositions:** hostname, zonename, direction.  
**Visibility:** operators and end users.  

This raw metric measures the number of packets sent and/or received by a
particular zone's VNICs, optionally decomposed by hostname, zonename, or
direction.


## Node.js-related metrics

The Node.js metrics provide high-level visibility into several types of activity
for Node programs running v0.4.x or later.  Each metric provides fields for
decomposing by host, zone, or application.


### Node.js 0.4.x: garbage collection operations

**Name:** node.gc_ops.  
**Raw metric:** number of garbage collection operations.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, gctype, latency (heatmap).  
**Visibility:** operators and end users.  

This metric measures the total number of garbage collection operations for
Node.js programs, optionally decomposed by type of GC (mark-and-sweep or
scavenge).  The "latency" field enables visualizing GC operation time as a
heatmap.


### Node.js 0.4.x: HTTP client operations

**Name:** node.httpc_ops.  
**Raw metric:** HTTP client operations.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, http_method, http_url, http_path, raddr, rport, latency (heatmap).  
**Visibility:** operators and end users.  

This metric measures the total number of HTTP client operations for Node.js
programs, where each operation consists of a request and a response.  The result
can be decomposed by any of several HTTP request properties.  The "latency"
field enables visualizing HTTP client request latency as a heatmap.


### Node.js 0.4.x: HTTP server operations

**Name:** node.httpd_ops.  
**Raw metric:** HTTP server operations.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, http_method, http_url, http_path, http_origin, raddr, rport, latency
(heatmap).  
**Visibility:** operators and end users.  

This metric measures the total number of HTTP server operations for Node.js
programs, where each operation consists of a request and a response.  The result
can be decomposed by any of several HTTP request properties.  The "latency"
field enables visualizing HTTP server request latency as a heatmap.


### Node.js 0.4.x: socket operations

**Name:** node.socket_ops.  
**Raw metric:** socket operations.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, optype, raddr, rport, size (heatmap), buffered (heatmap)
**Visibility:** operators and end users.  

This metric measures the total number of socket read/write operations for
Node.js programs.  The result can be decomposed by the remote address or port
and the operation type.  The result can be viewed as a heatmap by operation size
(how many bytes were read or written) or by how many bytes are buffered inside
Node.  This last heatmap provides observability into memory usage resulting from
inadequate flow control.


## Syscall-related metrics
### System calls: system calls

**Name:** syscall.syscalls.  
**Raw metric:** number of system calls completed.  
**Decompositions:** hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, syscall, latency (heatmap), cputime (heatmap).  
**Visibility:** operators and end users.  

This raw metric reports the total number of system calls (syscalls), which
represent application requests to the operating system.  Since applications
interface with the filesystem, disks, network, other applications, and the
system itself through syscalls, examining syscalls and syscall latency provides
low-level insight into most forms of application latency.

This metric allows users to examine syscall latency (how long the system call
took) using a heatmap decomposed by host, zone, application, or syscall.  The
"cputime" heatmap presents a similar visualization based on the actual CPU time
used by the syscall rather than elapsed wall clock time.


## TCP-related metrics

The TCP metrics provide visibility into TCP activity and errors.


### TCP: connections

**Name:** tcp.connections.  
**Raw metric:** number of TCP connections opened, including both server and client
connections.  
**Decompositions:** hostname, conntype.  
**Visibility:** operators only.  

This metric reports the number of TCP connections opened as both clients and
servers.  Applications opening many connections to the same remote host might
consider using a single persistent connection to avoid the overhead of TCP
connection setup and teardown.


### TCP: errors

**Name:** tcp.errors.  
**Raw metric:** total number of TCP errors.  
**Decompositions:** hostname, errtype.  
**Visibility:** operators only.

This metric reports the number of TCP errors and can be decomposed by the error
type.  Different TCP errors have different underlying causes, all of which can
contribute to application latency.  For example, retransmitted segments indicate
packet loss in the network, which causes application activity to block at least
as long as the configured TCP retransmit timeout (typically multiple seconds).


### TCP: segments

**Name:** tcp.segments.  
**Raw metric:** total number of TCP segments (packets) sent and received.  
**Decompositions:** hostname, direction.  
**Visibility:** operators only.  

This metric reports the total number of TCP segments (packets) sent and received
and can be used to observe network activity over TCP.


## ZFS-related metrics:

The ZFS metrics report how disk space is used by ZFS pools and their
filesystems.  Typically, an individual server will have one or more storage
pools, each of which may contain any number of datasets (filesystems and
volumes), each of which may contain any number of snapshots.  Some of these
datasets are used by the system itself, while the others are allocated to
individual zones.  Each ZFS metric reports either by dataset or by pool.
Dataset-level metrics provide a "zdataset" field for decomposing by dataset
name, while pool-level metrics provide a "zpool" field for decomposing by pool
name.

ZFS filesystems are not fixed in size: by default, storage for each filesystem
is allocated from a single pool.  Most configurations limit filesystem size by
specifying a quota, which can be observed using the metrics below.  ZFS also
provides reservations, which guarantee space rather than limit it.

The flexibility of ZFS storage configuration makes space accounting complex.  Be
sure to understand all of the concepts and metrics here before drawing
conclusions from these metrics.  See the zfs(1M) man page for details.


### ZFS: quota size

**Name:** zfs.dataset_quota.  
**Raw metric:** total of all ZFS dataset quotas.  
**Decompositions:** hostname, zdataset.  
**Visibility:** operators and end users.  

In raw form, this metric reports the sum of all quotas.  This can be decomposed
by hostname and ZFS dataset.  This metric only applies to datasets with quotas.

It's important to note that the sum of all quotas for a single system is not
related to the total storage on that system.  For one, not all filesystems have
quotas.  Additionally, quotas do not guarantee available space.  Thus, the sum
of quotas could be less than, equal to, or greater than the total space.


### ZFS: unused quota

**Name:** zfs.dataset_unused_quota.  
**Raw metric:** total unused quota for all ZFS datasets.  
**Decompositions:** hostname, zdataset.  
**Visibility:** operators and end user.  

In raw form, this metric reports the sum of unused quota for all ZFS datasets.
This can be decomposed by hostname and ZFS dataset.  Like the "quota size"
metric, this metric only applies to datasets with quotas.

This metric is not quite the same as the difference between "quota" and "used
space".  For one, the "used space" metric includes space used by datasets with
no quota configured, which are not counted here.  Additionally, this metric
includes space used by a dataset's children, since that space is counted against
a dataset's quota, while the "used space" metric does not include a dataset's
children (since that's reported separately).

It's also important to remember that since ZFS filesystems allocate from a
common pool of storage, each dataset's unused quota overlaps with that of every
other dataset (unless reservations are being used).  So it's not necessarily
true that the unused quota is space that's available for use.


### ZFS: used space

**Name:** zfs.dataset_used.  
**Raw metric:** total used space for all ZFS datasets.  
**Decompositions:** hostname, zdataset.  
**Visibility:** operators and end user.  

In raw form, this metric reports the sum of used space for all ZFS datasets.
This can be decomposed by hostname and ZFS dataset.

The used space for a dataset includes space used by the dataset itself, its
snapshots, and any unused reservation configured on the dataset.  However, this
metric does *not* include space used by child datasets, since they're reported
separately.

See the "ZFS: unused quota" metric for additional details on free space
accounting.


### ZFS: free space in pool

**Name:** zfs.pool_free.  
**Raw metric:** total free space for all ZFS pools.  
**Decompositions:** hostname, zpool.  
**Visibility:** operators only.  

In raw form, this metric reports the sum of free space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.


### ZFS: used space in pool

**Name:** zfs.pool_used.  
**Raw metric:** total used space for all ZFS pools.  
**Decompositions:** hostname, zpool.  
**Visibility:** operators only.  

In raw form, this metric reports the sum of used space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.


### ZFS: total space in pool

**Name:** zfs.pool_total.  
**Raw metric:** total space in all ZFS pools.  
**Decompositions:** hostname, zpool.  
**Visibility:** operators only.  

In raw form, this metric reports the sum of all space for all ZFS pools.  This
can be decomposed by hostname and ZFS dataset.


# Fields

Fields are used for decomposition and predicating.  To see which fields are
provided by which metrics, see "Metrics" above.

## Discrete fields

The following fields' values are strings.  Decomposing by one of these fields
could yield a stacked line graph rather than a single line graph (or, for
individual values, a vector rather than a scalar):

* **conntype**: type of TCP connection, either "active" (client) or "passive"
  (server)
* **cpu**: CPU identifier (e.g., "cpu0")
* **cpumode**: CPU mode, either "user" or "kernel"
* **disk**: disk identifier
* **direction**: direction of bytes transferred, either "sent" or "received"
* **execname**: application name
* **errtype**: TCP error description
* **fstype**: filesystem name (e.g., "zfs")
* **gctype**: type of garbage collection (e.g., "scavenge")
* **hostname**: server name
* **http_method**: HTTP request method (e.g., "GET")
* **http_origin**: Origin IP address for HTTP request, as reported by
  "X-Forwarded-For" header
* **http_path**: HTTP request URL path (URL without query parameters)
* **http_url**: HTTP request URL
* **leavereason**: description of why a process came off-CPU
* **nic**: network interface identifier (e.g., "e1000g0")
* **optype**: operation type, often "read" or "write" but can be any operation
  depending on the  metric
* **pexecname**: parent process application name
* **pid**: process identifier
* **ppid**: parent process identifier
* **psargs**: process name and arguments
* **ppsargs**: parent process name and arguments
* **raddr**: remote IP address
* **rport**: remote TCP port
* **syscall**: name of a system call
* **zdataset**: ZFS dataset name
* **zonename**: Zone (or SmartMachine or Virtual Machine) name
* **zpool**: ZFS pool name

## Numeric fields

The following fields' values are numbers.  Decomposing by one of these fields
typically yields a heatmap rather than a scalar or vector:

* **busytime**: percent of time spent doing work (e.g., processing I/O)
* **bytes**: number of bytes, both read and written
* **bytes_read**: number of bytes read
* **bytes_write**: number of bytes written
* **buffered**: number of bytes currently buffered in memory
* **cputime**: time spent actually on-CPU
* **iops**: I/O operations, both read and write
* **iops_read**: read I/O operations
* **iops_write**: write I/O operations
* **latency**: how long an operation took
* **offset**: byte offset within a file or block device
* **packets**: number of packets sent or received
* **packets_in**: number of packets received
* **packets_out**: number of packets sent
* **runtime**: time spent running continuously on CPU
* **size**: size in bytes of a packet or operation
* **utilization**: percent of overall resource utilized (for CPUs, this is the
  same as percent of time busy)
