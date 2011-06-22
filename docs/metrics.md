# Notes on all metrics

Each metric description includes:

* Name: the name of the metric in the API
* Raw metric: what the metric itself measures.  Note that with no decompositions
or predicates, a metric reports data for *all servers within a data center*.
* Fields: a list of fields which can be used for filtering and decomposition.
All metrics contain a "hostname" field, which means you can choose to examine
only the data from a single server ("predicating") or breakdown the raw value by
server name ("decomposition").
* Visibility: indicates whether the metric is available for cloud operators
only or both operators and end users.  The "hostname" field is always hidden
from end users.


# Metrics

## CPU-related metrics

The CPU metrics provide observability into CPU resource usage.  These metrics
allow operators to understand CPU utilization and saturation and for customers
to understand their usage of CPU resources and compare that to their limits.


### CPU: CPUs

*Name:* cpu.cpus.  
*Raw metric:* number of CPUs.  
*Decompositions:* hostname, cpu, utilization (heatmap).  
*Visibility:* operators only.  

This raw metric measures the number of CPUs, which itself may not be very
interesting.  However, the raw value can be decomposed by current utilization
and viewed as a heatmap, allowing operators to quickly see which CPUs are hot
within the datacenter or on a particular server.


### CPU: thread executions

*Name:* cpu.thread_executions.  
*Raw metric:* number of times any thread runs continuously on CPU.  
*Decompositions:* hostname, zonename, pid, execname, psargs, ppid, pexecname,
ppsargs, leavereason, runtime (heatmap).  
*Visibility*: operators and end users.  

This raw metric counts the number of times any thread was taken off CPU.  This
can be used to understand CPU utilization at a very fine-grained level, since
you can observe which applications are running, for how long they're running
before being kicked off CPU, and why they're being kicked off CPU.  This in turn
can help understand whether an application is actually using a lot of CPU
directly (e.g., on CPU for long periods doing computation) vs. not (e.g., on CPU
for many short bursts, then waiting for I/O).


### CPU: aggregated CPU usage

*Name:* cpu.usage.  
*Raw metric:* total amount of available CPU time used expressed as a percent of
1 CPU
*Decompositions:* hostname, zonename, cpumode.  
*Visibility:* operators and end users.  

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

*Name:* cpu.waittime.  
*Raw metric:* total amount of time spent by runnable threads waiting for a CPU.  
*Decompositions:* hostname, zonename.  
*Visibility*: operators and end users.  

This raw metric measures the total amount of time spent by runnable threads
waiting for a CPU.  The longer the aggregated wait time, the more time threads
spent waiting for an available CPU while ready to run.  Even on relatively idle
systems, it's normal to see non-zero wait time, since there are often more
threads ready to run than CPUs.  However, persistent high wait times indicate
CPU saturation.


### CPU: 1-minute load average

*Name:* cpu.loadavg1.  
*Raw metric:* 1-minute load average.  This loosely correlates with the average
number of threads either running or runnable over the last minute.  
*Decompositions:* hostname, zonename.  
*Visibility:* operators only.

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

*Name:* disk.disks.  
*Raw metric*: number of disks.  
*Decompositions*: hostname, disk, iops (heatmap), iops\_read (heatmap),
iops\_write (heatmap), bytes (heatmap), bytes\_read (heatmap), bytes\_write
(heatmap), busytime (heatmap).  
*Visibility:* operators only.  

This raw metric measures the number of disks, which itself may not be very
interesting.  However, the raw value can be decomposed by percent busy time,
number of I/O operations completed, or number of bytes transferred, and the
result viewed as a heatmap.  This allows operators to quickly identify which
disks are busy within a datacenter or on a particular server.

Since individual disks have finite limits on both data throughput and IOPS, this
metric also allows administrators to identify disks that are maxed out, which
may be limiters for application performance.


### Disk: bytes read and written

*Name:* disk.physio_bytes.  
*Raw metric:* number of bytes read or written to disk.  
*Decompositions*: hostname, disk, optype.  
*Visibility:* operators only.  

This metric measures the raw number of bytes read and/or written to disks.  This
allows operators to see whether disks are being driven to maximum throughput
(i.e. whether the workload is disk throughput-bound) as well as the
decomposition of read and write operations in the workload.


### Disk: I/O operations

*Name*: disk.physio_ops.  
*Raw metric*: number of disk I/O operations completed.  
*Decompositions*: hostname, disk, optype, size (heatmap), offset (heatmap),
latency (heatmap).  
*Visibility:* operators only.  

This raw metric measures the raw number of read and write operations completed
by disks.  This allows operators to see whether disks are being driven to
maximum IOPS throughput (i.e. whether the workload is disk IOPS-bound).

Additionally, this metric provides decompositions by size and offset, which
help operators understand the nature of the I/O workload being applied, and
a decomposition by latency which provides deep understanding of disk performance
as it affects the workload.


## Filesystem-related metrics
### Filesystem: logical filesystem operations
### Filesystem: logical read/write operations
### Filesystem: logical bytes read/written
## Memory-related metrics
### Memory: resident set size
### Memory: maximum resident set size
### Memory: anonymous memory used
### Memory: maximum anonymous memory used
### Memory: excess memory reclaimed
### Memory: pages paged in
## NIC-related metrics
### NIC: NICs
### NIC: bytes sent and received
### NIC: packets sent and received
### NIC: VNIC bytes sent and received
### NIC: VNIC packets sent and received
## Node.js-related metrics
### Node.js 0.4.x: garbage collection operations
### Node.js 0.4.x: HTTP client operations
### Node.js 0.4.x: HTTP server operations
### Node.js 0.4.x: socket operations
## Syscall-related metrics
### System calls: system calls
## TCP-related metrics
### TCP: connections
### TCP: errors
### TCP: segments
## ZFS-related metrics:
### ZFS: unused quota
### ZFS: used space
### ZFS: quota size
### ZFS: free space in pool
### ZFS: used space in pool
### ZFS: total space in pool
