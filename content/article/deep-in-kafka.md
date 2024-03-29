---
title: "深入 Kafka"
date: 2022-07-02T13:43:10+08:00
draft: true
categories: ["article"]
length: 0
description: "[迁移]了解一种分布式消息流服务，并掌握如何规划，然后进一步了解与开发相关的内容。"
---

# 概念

Apache Kafka 是一个开源分布式事件流平台，被数千家公司用于高性能数据管道、流分析、数据集成和任务关键型应用程序。Apache Kafka 在制造业、银行、保险、电信等大数据分析与处理方面存在着巨大的用途，官网也说 "More than 80% of all Fortune 100 companies trust, and use Kafka."。

![Kafka 的架构](/article/deep-in-kafka/kafka-arch.svg)

官方网站：[https://kafka.apache.org](https://kafka.apache.org/)

笔者研发的 zTrader Framework 支持接入各种 MQ 中间件，其中 Kafka 也在支持的列表，用作交易日志、风控通知、实时消息、量化策略日志等。

学习 Kafka 的重要性可见一斑。

Kafka 的构建使用了如下几个概念：

- 消费者：从 Kafka 中获取数据并进行处理。
- 消费者组：通过 ID 标识一个组，同组的消费者无法重复消费消息，不同组的可以。
- 生产者：向 Kafka 中投放数据。
- 集群：多个 Kafka 服务实例构成的逻辑概念。
- 节点（Broker）：一个 Kafka 服务实例。
- 主题（Topic）：一个逻辑概念，通常用于区分业务类型。
- 分区（Parition）：一个物理概念，一个主题中可以存在多个分区，分区落实到集群中的服务器存储上是目录。
- 消息：数据。

# 集群

下面介绍 Kafka 集群具备的特点。

## 主从模式

Kafka 的高可用依赖于 Apache Zookeeper（官方网站：[https://zookeeper.apache.org](https://zookeeper.apache.org/)），因此 Kafka 集群中需要 Zookeeper 集群。由于 Zookeeper 集群使用了 Zab 算法作为高可用方案，那么实际生产环境中建议部署5个 Zookeeper 节点。通常在 Zab 算法中3个节点认为是高可用的，当其中一个节点宕机以后，另外两个节点仍旧可以提供服务，但是如果这两个中任意一个损坏，那么整个集群将不可用，因此推荐部署5个节点。

> **什么是 Zookeeper?**
> 
> Apache ZooKeeper 致力于开发和维护开源服务器，实现高度可靠的分布式协调。
> 
> ZooKeeper 是一个集中式服务，用于维护配置信息、命名、提供分布式同步和提供组服务。分布式应用程序以某种形式使用所有这些类型的服务。每次实现它们时，都要做大量的工作来修复不可避免的错误和竞争情况。由于实现这些类型的服务的困难，应用程序最初通常会忽略它们，这使得它们在变化面前变得脆弱并且难以管理。即使做得正确，这些服务的不同实现也会导致应用程序部署时的管理复杂性。

Kafka 集群中的节点都向 Zookeeper 注册，称为领导者（Leader）的叫做控制器节点（Controller），负责读写请求。如果成为追随者（Follow），那么只能从控制器节点同步数据。

## 高吞吐量

Kafka 诞生于大数据蓬勃发展的时代，高吞吐量是必然的。一些精巧的设计包括：

- 存储方面进行顺序写入（追加写）和分段存储。
- 查询方面使用了稀疏索引和二分查找。
- 网络方面借助了 Java NIO 的 Reactor 网络设计模式
- 无论是网络还是硬盘都借助了零拷贝机制。

### 顺序写入和分段存储

由于只是追加写入，那么磁盘数量和读写速度达到一定数量将会与内存持平。
现代 SSD 速度和价格逐渐变得低廉和高性能，再加上 RAID 技术，理论上硬盘读写不会成为瓶颈。
甚至一个硬盘通过 PCIe 总线直接连接 CPU。

Kafka 将数据叫做日志文件，``.index`` 文件为索引文件，``.log`` 文件是数据文件（默认1GB）。笔者认为 1GB 的大小很可能是 Kafka 官方经过各个使用场景的反馈和大量的生产环境测试得来的魔法数字，因此不建议更改。小文件可以避免查找时加载几百GB的文件带来的内存空间浪费。

### 查询

Kafka 中提供两个概念用来表示位置：

- Offset：相对偏移位置。
- Postiotion：磁盘物理位置。

由于 Kafka 通常负载较多的数据，查询成为一个难题。官方源代码中使用稀疏索引构建 Offset 查询表。
然后通过比较 Offset 表条目的两端来快速确认到指定的 Offset 范围处于那几个行，然后加载目标行的全部 Offset，再去 Offset 和 Position 对应的表格中找到对应的物理磁盘位置。

![查询](/article/deep-in-kafka/kafka-maps.svg)

### 零拷贝

零拷贝在 Linux 上的技术为 [sendfile](https://man7.org/linux/man-pages/man2/sendfile.2.html) 函数，Windows 上是 [TransmitFile](https://learn.microsoft.com/en-us/windows/win32/api/mswsock/nf-mswsock-transmitfile) 函数。

如下图所示，Kafka 的数据读取在操作系统、硬盘和网卡之间是一层层拷贝的，利用零拷贝技术可以简化拷贝路径。如果当前的服务器主板具备DMA机制，那么将会实现更快的文件拷贝。

![零拷贝](/article/deep-in-kafka/kafka-zero-copy.svg)

### NIO 的 Reactor 模式

Java 的 NIO 要比 BIO 复杂一些，我们从如何设计一个 Kafka 网络模型来了解 Kafka 网络。

通常情况下，Kafka 的客户端分为生产者和消费者，但是一个业务服务有可能既是生产者也是消费者，那么我们只需要客户端的概念。
客户端可以进行读写操作，我们在 Kafka 节点提供一个 ``ServerSockerChannel`` 监听默认端口 9092。``ServerSocketChannel`` 向 ``Selector`` 注册 ``OP_ACCEPT`` 事件，当连接请求到来时，``Selector`` 就会将请求进行派发，给到 ``Acceptor``，``Acceptor`` 创建一个 ``SocketChannel`` 对象来处理新的连接。

``SocketChannel`` 向 ``Selector`` 注册一个 ``OP_READ`` 事件。由一个新的处理线程监听注册的 ``OP_READ`` 事件，负责读取硬盘数据。这个新的处理线程向 ``Selector`` 注册 ``OP_WRITE`` 事件，当数据准备好后，由另一个新的处理线程监听 ``OP_WRITE`` 事件，另一个新的处理线程拿到数据响应给客户端。

![Java 的 NIO](/article/deep-in-kafka/network-java-nio.svg)

但是这样存在问题，首先是每次都要创建新的线程，这消耗了资源，一个 Java 线程就是一个操作系统线程，JVM 的 Thread 类只是包装，另外一个问题是如果处理线程耗时太长将会影响后来的新请求。

- 我们增加一个队列，解耦 ``SocketChannel`` 与整个系统，新创建的请求句柄直接写入到队列中，增加吞吐量，降低耦合。
- 再增加一个线程池，对处理线程进行复用。

![Java 的 NIO 2](/article/deep-in-kafka/network-java-nio2.svg)

其实这个方案还是存在问题，``ServerSocketChannel`` 只是注册 ``OP_ACCEPT`` 事件然后转发，而 ``Selector`` 被大量的对象注册和取消注册各种事件，``Selector`` 在该方案中压力是较大的，那么我们可以创建多个 ``Selector`` 。

![Java 的 NIO 3](/article/deep-in-kafka/network-java-nio3.svg)

此时，我们的方案看起来没什么问题了。Kafka 的网络模型与我们的方案大体一致。

![Kafka 网络架构](/article/deep-in-kafka/network-kafka.png)

在 Kafka 的源代码中，客户端（无论是生产者还是消费者）创建的 TCP 请求都会通过 ``ServerSocketChannel`` 监听的 9092（默认端口号）接收，然后交给 ``Selector``，``ServerSocketChannel`` 向 ``Selector`` 注册了 ``OP_ACCEPT`` 事件。Kafka 默认使用了三个 ``Processor`` 处理消息，每个 ``Processor`` 中都有一个队列，用来存放 ``Selector`` 创建的 ``SocketChannel``，然后由 ``KSelector`` 消费，本质是个循环。``KSelector`` 读取二进制数据，然后封装成 ``Request`` 对象放到 ``RequestChannel`` 中等待 `KafkaRequestHandlePool` 线程池中的 ``KafkaHandleRequest`` 线程（线程池默认大小为8。）消费。``KafkaHandleRequest`` 线程联系内存和存储（例如文件系统），进行读写操作。然后，将响应的数据包装成 ``Response`` 对象放入 ``ResponseQueue``，等待被循环消费发送给客户端。

## 高可用

在 Kafka 中，节点分为领导者和跟随者，领导者维护了 ISR（In Sync Replica，包含领导者分区和跟随者分区）。消息写入到领导者的分区之后，Kafka 通过策略写入到了 ISR 中记录的跟随者，当大多数的跟随者写入消息成功后，那么 Kafka 的领导者就向生产者反馈消息投递成功。

# 场景评估与容量规划

大部分事物都遵循二八定律或者一九定律。

接下来我们将从一个每日10亿规模的请求量被发送到 Kafka 集群的案例开始。

## 机器配置

我们知道，电商类应用的请求量依赖于终端用户，如果这个网站具备全球属性，那么你需要合理评估不同可用域的请求量分布情况。例如在 UTC+8:00 时区，人们通常早上7点就开始了新的一天，电商类应用的使用频段通常是午休或者晚上下班后，一些有各类活动的节日除外。

如果你开始新的架构，并没有日志可视化数据作为参考依据，那么经过运营专家们的评估后通常是 11:00AM ~ 14:00 AM 以及 17:00PM ~ 24:00 PM 是最活跃的时段。我们的集群需要花费上午的3小时加上下午的7小时处理 80% 的请求，也就是 8亿的请求（读写请求）。

那么我们计算以下高峰期的负载量：8亿 / 10 小时 = 22222 请求每秒。

假设每个请求是 30KB，通常情况下一个消息的大小只有几个字节，但是客户端程序通常会合并日志请求进行批量发送，那么我们假设最大合并大小为80条消息。

10亿 x 30KB = 28TB，每日需要存储 28TB 的数据。

假设我们为 Kafka 设置的副本数量为2，那么每个 Kafka 节点至少需要 56TB 的存储空间。我们在 Kafka 上的数据保留周期是3天，那么就是 168TB的数据量。

至于容量，推荐目标容量的1.8倍，也就是300TB。

按照笔者的经验，通常2~3台物理机是可以负载的，考虑到负载的安全性，通常我们将资源数量升级为2~4倍。接下来我们来看看使用什么硬盘。
SSD（固态硬盘）具备较好的随机读写能力，像 MySQL 等数据库应用通常查询某个表格的某一行数据，无论经过存储引擎的怎样转换都是随机读写硬盘上的某个数据块。
Kafka 在我们前边提到是顺序写入的设计，因此我们更加偏向机械硬盘，企业级别的通常使用SAS硬盘的RAID阵列。

## RAID

关于 RAID 级别的安全性与存储大小可以通过如下表格获得：

级别 | 最小硬盘数量 | 特性
--- | --- | ---
0 | N >= 2 | 多个硬盘的直接组合，数据分为 N 份，并发的写入 N 个磁盘。读写性能是单硬盘的 N 倍，但是不提供数据安全性保证。
1 | N >= 2 | 提供一个硬盘的容量，数据在 N 块硬盘之间拷贝，由于数据发生了镜像，那么安全性是最高的，但是一份数据的写入成功时间长短取决于最慢的那块硬盘。
2 | N >= 2 | RAID 0的改良版，以汉明码（Hamming Code）的方式将数据进行编码后分割为独立的位元，并将数据分别写入硬盘中。因为在数据中加入了错误修正码（ECC，Error Correction Code），所以数据整体的容量会比原始数据大一些。
3 | N >= 3 | 多出了一个存储校验数据的硬盘。N-1块硬盘实现并发读写，使用校验数据盘进行数据恢复，但是校验数据盘处于频繁的读写状态。
4 | N >= 3 | 与 RAID 3类似，但是条块单位为块或记录而不是位。
5 | N >= 3 | 相较于 RAID 3，将校验数据分布在不同的硬盘上，允许最多同时坏一块磁盘。如果有两块磁盘同时损坏了，那数据就无法恢复了。
6 | N >= 3 | 可以在有两块磁盘同时损坏的情况下，也能保障数据可恢复，引入了双重校验。虽然数据冗余性好，读取的效率比较高，但是写数据的性能差。
10 | N >= 4 | 先用 50% 的硬盘组建 RAID 1，然后在两个 RAID 1 上构建 RAID 0。
7 | - | Optimized Asynchrony for High I/O Rates as well as high Data Transfer Rates（最优化的异步高I/O速率和高数据传输率）。RAID 7等级是至今为止，理论上性能最高的RAID模式，它自身带有操作系统（实时事件驱动的操作系统）和管理工具，完全可以独立运行。
JBOD | - | 严格上来说不是一种RAID，因为它只是简单将多个磁盘合并成一个大的逻辑盘，并没有任何的数据冗余。数据的存放机制就是从第一块磁盘开始依序向后存储数据。如果某个磁盘损毁，则该盘上的数据就会丢失。

如果公司内部有专门的存储小组负责存储，可以通过系统直接申请创建光存储网络。

Kafka 集群中有一个 Acceptor 线程负责处理连接，通常我们调优 Processor 线程为 6~9 个，处理请求的线程池为32个。在 Kafka 中还有一些后台任务线程，例如定期清理 ISR 列表的等等，所以一个 Kafka 服务启动以后大概有一百多个线程。建议每个 Kafka 服务使用32个处理器核心，最低16个处理器核心。

至于网络方面，常见的服务器通常是4个业务网口，常见的有千兆、2.5Gbps、10Gbps等，超过 10pGbps 通常需要安装 PCIe 接口的网卡。

2.3 万 x 30KB = 0.65GB

我们的 Kafka 集群网络每秒钟需要能处理 0.65GB 的数据，换算成比特，那么每秒网速为：5.1 Gbps。
由于副本之间的数据同步，我们推荐使用 10Gbps 的光口网卡或者电口网卡。

看起来是比较昂贵的配置。当然了，又有多少公司日请求量能达到10亿，如果请求量达到10亿规模应该也不会缺这点机器费用了。

## 集群规划

Zookeeper 的服务不推荐与 Kafka 服务安装到同一台服务器上，新版本的 Kafka 服务内置了 Zookeeper 服务。
通常大型公司会将各种消息中间件聚合为业务中台，通过流程系统可以进行申请以选择合适的版本。
由于历史遗留问题，Kafka 在 0.8.x 之后才变得稳定，因此有不少公司依旧采用这个版本，但是有些新的服务被搭建时采用了 1.x.x 的版本。

我们推荐使用最新的版本构建消息集群。

## 核心参数

- ``num.network.threads=3``：配置存在多少个 ``Processor`` 对象，较高值以提高网络性能。
- ``num.io.threads=8``：配置存在多少个 ``KafkaRequestHandle`` 对象，较高值以提高请求处理能力。
- ``log.retention.hours=168``：配置数据的生命周期小时数。
- ``message.max.bytes=997``：节点默认最大接收消息的大小。
- ``log.flush.interval.messages``：根据消息量的缓存持久化阈值。
- ``log.flush.interval.ms``：根据时间的缓存持久化阈值。

## 运维工具

运维工具目前主要是 KafkaManager。笔者在工作过程中也可开发过一个小工具，可以实现在负载不均衡时对主题进行迁移实现节点间负载均衡，并且实现了安全性检查机制：

- 通过监控系统或者守护进程读取集群机器负载。
- 运维通过 Web 界面设置参数。
- 到达某个阈值后自动执行。
- 判断是否为业务高峰期。
- 发送日志到 ELK 集群，然后通过 WebHook 通知运维同学。

### 压力测试

在 Kafka 集群交付前应该进行压力测试，然后还需要关注操作系统各方面的参数。
主要思路就是创建一个主题和分区，然后通过 Kafka 提供的消费者和生产者 perf 工具进行压测。

```shell
kafka-server-start.sh -daemon server.properties
kafka-topics.sh --create --zookeeper zk0:2181,zk1:2181,zk2:2181 --replication-factor 1 --partitions 1 --topics test
kafka-topics.sh --list --zookeeper zk0:2181,zk1:2181,zk2:2181
kafka-console-producer.sh --broker-list kfk0:9092,kfk1:9092,kfk2:9092 --topics test
kafka-console-consumer.sh --bootstrap-server kfk0:9092,kfk1:9092,kfk2:9092 --topics test  --from-beginning
kafka-producer-perf-test.sh --topic test --num-records 250000 --record-size 180 --throughput -1 --producer-props bootstrap.servers=kfk0:9092,kfk1:9092,kfk2:9092
kafka-consumer-perf-test.sh --broker-list kfk0:9092,kfk1:9092,kfk2:9092 --fetch-size 180 --messages 250000 --topic test
```

### 其他问题

Kafka 的副本机制在于对数据上使用分区进行多副本高可用，服务上使用 Zookeeper 进行主从高可用。如果系统的数据负载量太大，可以通过创建多个分区来平衡节点的压力，通过 ``kafka-topics.sh --alter`` 进行指定。

如果需要调整分区与节点的映射关系，那么通过 ``kafka-reassign-partition.sh`` 实现，这个命令接收一个 JSON 文件，此文件描述了分区与节点ID 的对应关系。

负载不均衡的主题需要手动迁移，先将要迁移的主题编写到 JSON 文件，然后执行 ``kafka-reassign-partition.sh`` 生成迁移计划，本质还是个 JSON，再次使用该工具进行迁移，最后使用该命令进行验证，整个过程所用到的参数分别是 ``--generate``，``execute``，``verify``。
迁移数据很占用带宽，不建议高峰期操作。

领导者分区承担了读写请求，因此领导者分区在节点之间自动进行负载均衡，如果负载不均衡，那么可以检查 ``auto.leader.rebalence.enable`` 是否为 ``true``，``leader.imbalence.per.broker.percentage`` 配置了重平衡比率，默认10%。``leader.imbalence.check.interval.seconds`` 配置了检测周期，默认300秒。

# 针对开发的相关问题

我们将会从客户端和服务器端进行完整了解。
一些参数都是客户端与服务器端相互配合的，甚至与集群相关。

## 客户端吞吐量问题

客户端的吞吐量取决于以下几个参数：

- ``buffer.memory``：客户端缓存设置，默认32MB，要按照消息大小进行设置。
- ``compression.type``：默认是 ``none``，不压缩。这个参数可以设置为 ``lz4`` 压缩，但是会消耗 CPU。
- ``batch.size``：如果批处理大小太小，会由于及早的到达阈值而频繁发送网络请求，导致吞吐量下降。如果该参数太大又会导致一条消息需要等待很久才能被发送出去。实际生产环境中，由于存在大量的消息，笔者建议调大。
- ``linger.ms``：默认值为0，表示立即发送。一般设置为 120，来避免一直未达到批处理大小导致消息处理延迟。

笔者在工作中发现，一些开发同学会采用默认参数先上线，然后由运维来提单优化，你也可以采用这个方式进行。

## 常见的客户端异常

- ``LeaderNotAvailableException``：领导者不可用，无法完成读写操作。通常是由于网络异常导致需要选举，等待选举完成就可以了。
- ``NotControllerException``：控制器所在的节点挂掉了，需要等待重新选举。
- ``NetworkException``：网络异常，可以配置超时。

以上三种异常都可以通过客户端重试解决，客户端配置 ``retires`` 参数即可。 
通过 ``retry.backoff.ms`` 设置重试时间间隔。
笔者建议为 Kafka 建立备用链路，例如写入其他 Kafka 网络或者直接写入到文件，当服务恢复后将文件中的日志数据重新投递。
如果消息不是很重要，那么可以直接丢弃。
笔者之前使用 Kafka 为计费服务提供支持，所采取的方式就是写入到一个名字叫做 ``当前时间戳-服务ID-MessageBackup.log`` 的文件。

重试参数有可能导致消息重复，并且消息的顺序可能会打乱。
消息乱序通过设置 ``max.in.flight.requests.per.connection=1`` 来保证生产者同一时间只能发送一条消息。

## Ack

生产者有个参数是 ``request.required.ack``，用于配置 Kafka 服务接收到数据以后作何动作：

- 1：当领导者分区写入成功以后就算成功，但是可能会丢失数据，不过性能会很好。
- 0：只要消息投递出去就算发送完成，不考虑数据是否真正到达 Kafka 服务。
- -1：ISR 列表中的全部副本写入成功才算发送完成。

在 Kafka 的服务端配置中，`min.insync.replicas` 参数配置了至少存在几个副本，如果 ISR 列表中的副本数低于该值，写入数据就会导致客户端错误。

通常情况下，我们认为数据不丢失的方案是：

- 分区副本大于等于2
- Ack 参数设置为 -1
- 最小ISR数量大于等于2

## 消费者组

消费者组是由多个消费者构成的，消费者组关注同一个主题，并且在主题上的分区上进行负载均衡，一个分区只能被一个消费者消费，如果分区数量小于消费者数量，那么必然会导致某些消费者线程挂起不工作。因此，笔者建议分区数量与消费者数量保持一致。

如果想要达到广播的效果，可是相同组的消费者无法重复读取消息，那么可以为不同的消费者线程指定不同的消费者组。

## 偏移量管理与监控

每个消费者的 SDK 内存中保存了对分区的消费的偏移量，SDK 工作线程会定期提交偏移量。较早的版本是提交给 Zookeeper，但是这样的设计官方认为不合理，因为 Zookeeper 是分布式协调中间件，属于轻量级的元数据存储，并不适合高并发的读写操作。

新版本的 Kafka SDK 提交给 Kafka 服务内部的主题：``__consumer_offsets``。
其 Key 是 消费者组ID + 主题 + 分区号，Value 就是偏移量。
每隔一段时间 Kafka 的辅助工作线程就会进行合并压缩，只保留最新的偏移量。
由于这个元数据分区可能承载着高并发的请求，因此默认的分区数量是50个。

如果要监控偏移量，可以使用该工具：[Kafka Offset Monitor](https://github.com/Morningstar/kafka-offset-monitor)。
当业务应用没有报错，但是存在较多的消息延迟，例如几万条消息，就可以通过工具进行确认，并提交给研发。

## 消费者故障感知

主要涉及到三个客户端参数：

- ``heartbeat.interval.ms``：消费者心跳时间间隔。Kafka 启动以后会在所有的节点上选择一台作为协调者，所有的其他节点必须与协调者保持心跳数据。
- ``session.timeout.ms``：多长时间感知不到心跳数据作为丢失，默认是10秒。
- ``max.poll.interval.ms``：两次数据拉取的时间间隔。如果超过了这个时间，那么就算做处理能力太弱，将会在消费者组中删除这个消费者。

## 消费者核心参数

- ``fetch.max.bytes``：配置一条消息的最大字节数。默认是1MB。
- ``connection.max.idle.ms``：消费者与 Kafka 节点之间的连接如果空闲超过一定的时间，就要回收连接，-1 表示保持连接。
- ``enable.auto.commit``：开启自动提交偏移量。
- ``auto.commit.interval.ms``：偏移量提交间隔，默认5秒。
- ``auto.offset.reset``：``earliest`` 表示当前主题下的各个分区有偏移量提交时，从当前偏移量开始消费，否则从0开始；``latest`` 表示当前主题下的各个分区有偏移量提交时，从当前偏移量开始消费，否则从新数据开始；``none`` 表示当前主题下的各个分区有偏移量提交时，从当前偏移量开始消费，否则只要有一个分区不存在提交的偏移量则抛出异常。

## 消费者重平衡

假设当前主题下存在两个分区，但是只有一个消费者。那么，当前消费者将会从两个分区中同时消费数据。
当加入新的消费者时，由于在同一个消费者组中，Kafka 将会进行重平衡。

消费者组中的消费者会选择一台节点作为协调者，这个协调者负责监控消费者组中全部消费者的心跳数据。
当出现消费者宕机后，Kafka 将会开启重平衡。

重平衡的实现机制如下：

Kafka 会对消费者组ID进行 Hash 操作，然后对 ``__consumer_offsets`` 的分区数量进行取模操作，默认是50。
``__consumber_offsets`` 主题的分区数量可以通过参数 ``offsets.topic.num.partitions`` 进行设置。
找到这个分区后，所在的节点就充当了协调者。

每个消费者都向协调者发送 JoinGroup 的请求。然后协调者选择一个消费者作为领导者，然后协调者会将消费者组的元数据发送给领导者。

领导者负责制定消费方案，然后通过 SyncGroup 请求发送给协调者。

协调者会将这个消息消费方案下发给全部的消费者，这个消费者就会从指定分区的领导者节点消费数据。

Kafka 消费者的重平衡策略有：range、round-robin 和 sticky。

- range：按照分区序号范围进行划分。
- round-robin：按照轮询的方式进行划分。
- sticky：最新的策略，尽量保证原本属于当前分区的消费者还处于当前分区中。

## LEO 与 HW

LEO 是 Log End Offset 的缩写，每次分区接收到一条消息都会更新自己的 LEO 变量，值是最新的 Offset + 1。标识当前日志文件中下一条待写入的消息的偏移量。每个分区都会维护自己的 LEO。

HW 是 High Water level 的缩写，LEO 用于更新 HW，如果跟随者与领导者同步了，此时 HW 就可以更新了。HW 之前的消息是对消费者可见的，消息属于提交状态，但是 HW 之后的消息是不可见的。ISR 列表中最小的 LEO 就是 HW。

本质上，LEO 和 HW 中间的数据是跟随者和领导者之间待同步的数据，同步完成后 HW 就会更新，然后数据将会对消费者可见。

还有一个名次是 LogStartOffset，缩写为 LSO，就是第一条消息的偏移量。

## 消息的顺序性

Kafka 只能保证当前主题下单个分区的消息顺序性，但是 Kafka 是在大数据的背景下提出的，那么如果一个主题只创建一个分区，这就破坏了 Kafka 最优秀的特性之一。

对于 Kafka 单个分区的顺序性，官方是这样实现的：

通常来讲，如果保证生产者到消费者之间顺序消费消息，那么生产者会加锁，创建一个保证有序投放到 Kafka。
但是由于网络原因可能会造成消息重复投递。
针对这个问题 Kafka 提供了生产者幂等性。生产者发送的每个 ``(Topic, Partition)`` 二元组都对应一个单调递增的序列号。
同时节点上的 Broker 也会维护一个 ``(Producer ID, Topic, Partition)`` 的三元组，并且每提交一个消息就单调递增。
对于接收的消息，如果序列号币当前 Broker 的序列号大，那么就接受，否则就丢弃。

- 如果消息的序列号比 Broker 维护的序列号的差值超过1，那么说明中间存在尚未写入的数据，存在数据空缺，此时 Broker 的动作就是丢弃该消息。生产者 SDK 将会抛出 ``InvalidSequenceNumber`` 异常。
- 如果消息的序列号等于  Broker 维护的序列号，那么说明消息是重复的，Broker 同样丢弃。生产者 SDK 将会抛出 ``DuplicateSequenceNumber`` 异常。
- 生产者发送失败后会重试，这样可以保证每个消息都被发送到 Broker。

## 时间轮算法

Kafka 内部存在较多的延时任务， 但是并没有基于 JDK 提供的 Timer 实现。因为 Timer 的插入和删除的时间复杂度是 O(logn) 的。
Kafka 使用 O(1) 的时间轮算法来实现延时任务。

时间轮的基本结构是一个数组，具备以下属性：

- tickMs：时间轮的间隔。
- wheelSize：时间轮的大小。
- interval：tickMs x wheelSize，一个时间轮的总的时间跨度。
- currentTime：当前时间的指针。

时间轮存在多个层级来容纳极小和极大的时间，无非是一层层缩小或者扩大时间轮的 tickMs 参数。

关于时间轮的详细探讨，可以关注笔者的其他文章，在此不多做介绍。