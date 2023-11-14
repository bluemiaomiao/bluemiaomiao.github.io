---
title: "深入 MongoDB"
date: 2021-01-03T00:58:49+08:00
draft: false
categories: ["article"]
length: 0
description: "[迁移]看完就能掌握 MongoDB。"
---

**我不喜欢 MySQL。**

MongoDB 的设计极为暴力，笔者发现 MongoDB 的查询线程并没有通过统计数据或者成本核算引擎进行处理，而是开启多个线程直接去加载数据进行运算，最快的线程返回，慢的全部取消执行。不过，这样却使得 MongoDB 的并发性能超越了 MongoDB 和 PostgreSQL。MongoDB 是一个 [NoSQL](https://zh.wikipedia.org/wiki/NoSQL) 类型的 OLTP（面向联机事务处理负载） 数据库，并且从源代码上支持了分布式的相关特性。笔者在万人规模的 Top10 公司工作，虽然很熟悉 MySQL，但是工作以后基本没有用过 MySQL 集群，因为 MySQL 的常用功能在 MongoDB 上都得到了支持，甚至做的更好。

并且，笔者中途闯过业，一开始购买的项目代码是 SpringBoot + MySQL 的，由于是创业公司，所以需求经常发生变动，频繁的发布新版本（几乎是每周一次或者两次更新）。这导致 MySQL 的 Schema 经常被修改，而且由于后端代码的并发处理并不是很好，导致依赖于 MySQL 的并发性能。笔者当时有 10万 日均活跃用户，所以在 2.0 版本的发布中要求合作方使用 MongoDB 作为数据存储，并发性能进一步得到了提高，而且也不用担心频繁修改 Schema 导致数据冲突了。MongoDB 提供的 Grid 存储也为笔者的创业公司解决了文件存储的难题。

MongoDB 使用的 NoSQL 使用了反范式设计，目前并没有完整的理论支持。MongoDB 依赖于 JSON 和 JavaScript 语法，对开发者来说比较简单。2010年后，MongoDB 的分布式特性主要依赖于分片来实现，分片的设计和调优相对复杂一些，主要考虑数据均衡带来的性能影响。
MongoDB 具备以下特性：

- 灵活和快速的应对业务变化
    - 多类型：同一个 Collection 可以包含不同类型的字段的 Document 对象。
    - 在线 Schema 变更：线上修改数据模式，无需应用和数据库下线和版本变更。
    - 数据治理：支持 JSON Schema 来规范数据模式，提供数据治理能力。
    - 大型文档支持：每个 Document 最大支持 16MB。
- 简单和快速的开发方式
    - 数据库引擎只需要在一个存储区读写。
    - 反范式、无关联的组织，极大的优化了查询速度。
    - SDK 提供的 API 自然。
- 原生的高可用和横向扩展
    - 一开始部署默认就是3个节点的复制集，提供5个9的高可用。
    - 轻松支持 PB 级别的数据。
    - 无缝扩展，对业务应用全透明，集群的调整对业务 SLA 无影响。

# 入门

笔者的公司采用了内部 SaaS 化运维系统来通过 Workflow 的方式来部署 MongoDB 数据库集群。初创或者小型公司可能会在公有云服务购买服务器然后部署 MongoDB 集群。接下来让我们部署一下吧。

目前来看，MongoDB 分为社区版和企业版，企业版在生产环境中是收费的，支持 SQL 功能，一般情况下使用社区版即可。官网可以下载到 ``tgz`` 格式的压缩包，但是不是很全面，我们通常使用的有 Mongos、MongoDB、 MongoDB Tools、Mongo Shell，下载好这些 deb/rpm 文件后直接进行安装。

## 安装

如果你想快速开始，使用 MongoDB Atlas 的云服务也是可以的。笔者采用的是 Ubuntu 22.04 LTS，可以通过在线 APT 仓库进行安装：

```shell
sudo apt-get install gnupg
curl -fsSL https://pgp.mongodb.com/server-6.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-6.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-6.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
```

上面的方法安装的都是稳定的最新版本。一般情况下推荐使用最新版本的 MongoDB，如果需要固化版本那么可以使用如下方法：

```shell
echo "mongodb-org hold" | sudo dpkg --set-selections
echo "mongodb-org-database hold" | sudo dpkg --set-selections
echo "mongodb-org-server hold" | sudo dpkg --set-selections
echo "mongodb-mongosh hold" | sudo dpkg --set-selections
echo "mongodb-org-mongos hold" | sudo dpkg --set-selections
echo "mongodb-org-tools hold" | sudo dpkg --set-selections
```

参考链接：[在 Ubuntu 上安装 MongoDB 社区版](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/)

安装完成后会有这些命令：

```shell
mongod        
mongodump     
mongoexport   
mongofiles    
mongoimport   
mongorestore  
mongos        
mongosh       
mongostat     
mongotop
```

后面我们会一一介绍。MongoDB 会创建一个配置文件（``/etc/mongod.conf``）和 Systemd 服务单元（``/usr/lib/systemd/system/mongod.service``）。

> 从MongoDB 4.4开始，如果打开文件数的值低于 64000，则会生成启动错误。
>
> 执行 ``ulimit -a`` 查看文件数。

生产环境中笔者推荐使用以下配置：

```shell
echo '* soft nofile 1000000' >> /etc/security/limits.conf
echo '* hard nofile 1000000' >> /etc/security/limits.conf
echo 'fs.file-max=1000000' >> /etc/sysctl.conf
echo 'vm.max_map_count=1000000' >> /etc/sysctl.conf
```

```shell
sysctl -p
```

并修改 Systemd 的配置（``/etc/systemd/system.conf``）:

```ini
DefaultLimitNOFILE=1000000
```

重启。有些操作系统非常不愿意修改 ulimit 的值，即便是修改上面的文件以后也返回的是默认值。为此 MongoDB 提供的服务单元配置文件自带了推荐的最大文件打开数：

```ini
[Unit]
Description=MongoDB Database Server
Documentation=https://docs.mongodb.org/manual
After=network-online.target
Wants=network-online.target

[Service]
User=mongodb
Group=mongodb
EnvironmentFile=-/etc/default/mongod
Environment="MONGODB_CONFIG_OVERRIDE_NOFORK=1"
ExecStart=/usr/bin/mongod --config /etc/mongod.conf
RuntimeDirectory=mongodb
# file size
LimitFSIZE=infinity
# cpu time
LimitCPU=infinity
# virtual memory size
LimitAS=infinity
# open files
LimitNOFILE=64000
# processes/threads
LimitNPROC=64000
# locked memory
LimitMEMLOCK=infinity
# total threads (user+kernel)
TasksMax=infinity
TasksAccounting=false

# Recommended limits for mongod as specified in
# https://docs.mongodb.com/manual/reference/ulimit/#recommended-ulimit-settings

[Install]
WantedBy=multi-user.target
```


参考链接：

- [金步国作品集](http://www.jinbuguo.com/systemd/systemd.unit.html#)
- [阮一峰的网络日志](https://ruanyifeng.com/blog/2016/03/systemd-tutorial-commands.html)

通过 APT 源安装的 MongoDB 无需修改操作系统最大文件打开数限制。使用下面的命令启动 MongoDB 服务并设置为开机自启动：

```shell
systemctl start mongod && systemctl enable mongod
```

我们可以通过 MongoDB Shell 来连接到 MongoDB Server 执行测试操作，MongoDB Shell 内置了 JavaScript 引擎。

```shell
mongosh --host localhost --port 27017
```

**启动后会提示 WiredTiger 推荐使用 XFS 文件系统，实际生产经验中 XFS 的周边修复工具特别少，并且容易在重启的时候被破坏，不推荐使用。推荐使用 EXT4 或者 ZFS。** 下面我们可以查看一下全部的数据库：

```shell
test> show dbs;
admin   40.00 KiB
config  12.00 KiB
local   72.00 KiB
```

## 聚合框架

除了基本的增删改查操作，MongoDB 自带了聚合框架。可以作用在一个或者多个集合上，然后将这些数据转化为期望的形式。相当于 SQL 中的 GROUP BY 、JOIN 操作。整个聚合运算过程称为 Pipeline，它是由多个 Stage 构成的。每一个 Stage 接收数据并进行处理，然后返回给下一个 Stage 作为输入。

![](/article/deep-in-mongodb/pipeline-stage.svg)

首先要定义一个 pipeline：

```javascript
pipeline = [$stage1, $stage2, ..., $stageN];
db.<CollectionName>.aggregate(pipeline, { options });
```

Pipeline 一定是在一个 Collection 上操作的。Stage 中有如下操作：

- ``$match``：过滤，等价于 SQL 的 ``where``。
- ``$project``：投影，等价于 SQL 的 ``as``。
- ``$sort``：排序，等价于 SQL 的 ``order by``。
- ``$group``：分组，等价于 SQL 的 ``group by``。
- ``$skip/$limit``：结果限制，等价于 SQL 的 ``skip/limit``。
- ``$lookup``：左外连接，等价于 SQL 的 ``left outer join``，不支持分片表。

这个 Stage 中还有很多的运算符号，比如 ``$project`` 中有 ``$map``、``$reduce``、``$filter`` 等。

**复杂的聚合操作应该尽量将 ``$match`` 放到 ``$project`` 之前，否则可能导致无法利用索引加速。**

## MongoDB Charts

通过拖拽的图形化交互构建可视化图表，可以直接读取 MongoDB 中的数据。

通过 iframe 的方式嵌入到其他的应用程序中。

# 模型与事务

## 模型设计

MongoDB 不遵从第三范式，并且允许冗余的数据存在。在进行业务建模的时候，首先分析好 Document 中应该存储哪些要素，然后按照性能进行优化：

- 最频繁的数据查询模式
- 最常用的查询参数
- 最频繁的数据写入模式
- 读写操作的比例
- 数据量的大小

对于时序数据，可以采用分桶的设计思路，例如将分钟级别的数据进行合并，每小时一个 Document 而不是每分钟一个 Document。这样可以大大减少存储的体积，并且可以减少索引数量，提高查询效率。

## 写操作事务

影响写操作行为的参数是 ``writeConcern``，决定了一个写操作达到多少节点才算成功。``w`` 参数取值包括：

- ``0``：发起写操作，不关心是否成功。
- ``1`` 到集群中最大的节点数：集群中写操作被复制到多少个节点才算成功。这个值如果不是集群中的大多数，可能会导致写操作丢数据。
- ``majority``：写操作被复制到大多数节点上才算成功。
- ``all``：写操作被全部节点接受以后才算成功，如果集群中的节点宕机，可能导致写操作一直完不成。

而 ``journal`` 定义如何才算成功，``j`` 参数的取值包括：

- ``true``：写操作落到日志文件才算成功。
- ``false``：写操作到达内存就算成功。

发起写操作的程序将被阻塞到写操作到达指定的节点数为止。 

以上参数通过 SDK 提供的 API 或者 MongoDB Shell 都可以进行设置，因为这些参数属于客户端参数。测试：

```javascript
// 在复制集测试参数
db.test.insert({count: 1}, {writeConcern: "majority"})
// 模拟网络延时
conf = rs.conf()
conf.members[2].slaveDelay = 5 // 5秒
conf.members[2].priority = 0 // 选举优先级
rs.reconfig(conf)
// 观察复制延迟下的写入
db.test.insert({count: 2}, {writeConcern: "majority"})
```

当给写操作配置了 ``wtimeout`` 参数时，可能会由于网络波动导致写入出错（等待副本写入超时），但是数据还是写进去了。这就要根据业务进行一些处理了。

## 读操作事务

针对读操作的事务处理，需要关注两个问题：

- 从哪个节点读取，由 ``readPreference`` 控制。
- 数据隔离性，由 ``readConcern`` 控制。

对于 ``readPerference`` 有以下几个可选值：

- ``primary``：只选择主节点。默认值。
- ``primaryPreferred``：优选选择主节点，如果不可用才选择从节点。
- ``secondary``：只选择从节点。
- ``secondaryPreferred``：优先选择从节点，如果从节点不可用则选择主节点。
- ``nearest``：选择最近的节点。

另外，MongoDB 还支持从指定的 Tag 读取数据，需要给 MongoDB 关联 Tag，然后在客户端指定 Tag。

有三个地方可以指定读取的数据库节点：

- MongoDB 连接字符串的 ``readPreference`` 参数。
- MongoDB 驱动程序 API。
- MongoDB Shell 的 ``readPref()`` 函数。

测试：

主节点写入数据后，各个从节点已经将数据同步完成。在从节点执行 ``db.fsyncLock()`` 将同步 Oplog 操作锁定。然后再去从节点写入。

```javascript
db.test.find()
db.test.find().readPref("secondary")
```

然后使用 ``db.fsyncUnlock()`` 解锁，再去读取。

```javascript
db.test.find().redPref("secondary")
```

读取操作应该考虑高可用，如果将 ``readPreference`` 设置为 ``primary``，但是主节点宕机后会导致故障转移期间没有节点可用。如果业务允许，则应该将参数值设置为 ``primaryPreferred``。

在使用 Tag 的情况，如果与 Tag 关联的节点全部失效也会导致没有节点可用。

对于 ``readConcern`` 有以下几个可选值：

- ``available``：读取所有可用的数据。从节点默认值。
- ``local``：读取所有可用且属于当前分片的数据。主节点默认值。MongoDB <=3.6.x 的版本不支持对从节点使用 ``local``。
- ``majority``：读取在大多数节点上提交完成的数据。安全的，防止脏读，对应关系型数据库的读已提交级别。要使用该参数，需要在 MongoDB Server 的配置文件中写入：
    ```yaml
    replication:
        enableMajorityReadConcern: true
    ```
- ``linearizable``：可线性化读取文档。读取速度比较慢，因此建议配合 ``maxTimeMS`` 使用。
- ``snapshot``：读取最近快照中的数据。只在多文档事务中生效，最高级别的读取。不会出现脏读、不可重复读和幻读。

``available`` 与 ``local`` 在复制集上没什么区别，在分片集群中才会有区别。MongoDB 在执行数据均衡操作的时候会发生 Chunk 的迁移。如果我们要在新分片中读取数据，那么：

- ``available``：config 中的记录的仍然是旧分片，但是能够读取到迁移中的数据，即便数据在新分片中没有迁移完。
- ``local``：不会读取到迁移中的数据。只有当 config 中记录的 Chunk 已经属于新分片。

对于测试，依旧可以使用插入操作和锁住 Oplog 同步来模拟。

## 多文档事务

大部分场景不推荐使用事务，应该通过合理的设计文档模型来避免使用事务。MongoDB 也有类似于 ACID 的保证。对于原子性，MongoDB 单 Document 在 1.x 版本就支持了，复制集多 Document 在 4.0 支持，分片集群的原子性在 4.2 支持。一致性使用 ``readConcern`` 和 ``writeConcern`` 保证。隔离性使用 ``readConcern`` 保证。持久性使用副本和日志保证。

事务默认会在60秒内完成，否则会被取消。事务的执行影响 Chunk 迁移的效率，而且正在迁移的 Chunk 会导致事务取消，因此需要重试。多文档事务必须使用主节点进行操作。涉及事务的分片不能使用仲裁节点。

对于事务的冲突错误，MongoDB 并不是与 MySQL 一致的：

- 当一个事务开始，如果事务要修改的文档被其他事务修改过，那么当前事务会发生错误。
- 如果一个事务已经开始修改一个文档，其他事务在尝试修改，那么其他事务会等待。

对于事务，应该尽量控制在 1000个文档以内的更新。

## Change Stream

类似于 SQL 数据库的触发器，但是 MongoDB 的 Change Stream 是异步回调事件。并且触发次数也不是1次，而是每个订阅事件的客户端，当发生故障恢复的时候，从上次断点重新触发。

Change Stream 基于 Oplog 实现的，在 Oplog 上开启一个 tailable 游标来追踪全部的节点上的变更操作，最终调用应用中定义的回调函数。

Change Stream 只会推送已经在大多数节点上提交的操作。对于某些类型的变更事件感兴趣可以使用聚合框架来实现：

```javascript
var change = db.collection.watch([{
    $match: {
        operationType: {
            $in: ['insert', 'delete']
        }
    }
}])
```

开启 Change Stream 功能需要以下配置：

```yaml
replication:
    enableMajorityReadConcern: true
```

当故障恢复，想要从中断的地方继续获取 Change Stream，只需要保留上一次变更通知的 ID 即可。然后使用 ``watch([], {resumeAfter: <_id>})`` 实现。

Change Stream 可以用于如下场景：

- 跨集群复制：订阅源集群中的 Change Stream，然后一旦变更，那么就立即同步到当前集群。
- 微服务联动：当一个微服务变更数据库时，其他微服务得到通知并做出相应的变化。

由于 Change Stream 依赖于 Oplog，因此中断时间不能超过 Oplog 回收的最大时间窗口。如果在 ``$update`` 操作时只更新了部分数据，那么由于后续的更新，Change Stream 的通知也是增量的。

## 索引

MongoDB 的索引基于 B+ 树，与 B 树的不同是，B+ 树支持子节点数量超过2个。假设集合中有两个索引:

```json
{city: 1}
{lastname: 1}
```

执行查询 ``db.member.find({city: "A", lastname: "boom"})`` 那么将会执行如下的过程：

1. 首先查看是否匹配查询计划缓存，如果有直接评估性能后按照计划执行。如果评估不合格，将会逐出缓存重新生成候选计划。
2. 如果不匹配，那么将会生成候选计划，然后评估候选计划，直接开启2个线程同时在两个索引上执行，选择快的索引返回数据并缓存计划。

对于组合索引，最精确的方式到查询语句的最前，排序放到中间，范围放到最后，但是极端情况要特殊考虑。

MongoDB 支持全文索引，在一些场景下可以代替 ElasticSearch。

创建索引是一个非常昂贵的操作，尽量在后台创建索引：``db.createIndex({}, {background: true})``

# 集群运维

MongoDB 有3中部署架构，常见的是单机版，然后是复制集和分片集。

![](/article/deep-in-mongodb/mongo-three-arch.svg)

## 连接

连接到 MongoDB 有两种协议：

- ``mongodb://节点1,节点2...,节点N/数据库名称?[参数]``：连接到复制集。
- ``mongodb://mongos1,mongos2,...,mongosN/数据库名称?[参数]``：连接到分片集。
- ``mongodb+srv://`` 支持通过DNS 的 SRV 服务解析得到全部的mongos地址。

## 复制集

复制集主要意义在于服务高可用。它的实现依赖于两个方面的功能：

- 数据写入时，数据迅速复制到另一个独立的节点。
- 在接受数据写入的节点发生故障时，MongoDB 将会自动选举出另一个新的节点进行写入。

MongoDB 还实现了其他的几个附加作用：

- 数据分发：将数据从一个区域复制到另一个区域，减少另一个区域的读延迟。
- 读写分离：不同类型的压力分别在不同的节点上运行。
- 异地容灾：在数据中心故障的时候快速切换到异地。

一个典型的复制集由3个以上具有投票权的节点组成，包括：

- 主节点：接受写入和选举时投票。
- 从节点：复制主节点上的新数据和选举时投票。

![](/article/deep-in-mongodb/replicaset.svg)

**数据是如何在节点间进行复制的呢？** 与 Redis 主从架构一致，当一个写操作到达主节点，它对数据的操作将会被记录下来，这些记录成为 Oplog。从节点通过在主节点打开一个 tailable 游标不断的获取主节点的 Oplog，并在自己的数据上进行回放，以此与主节点保持一致。如果从节点的同步过于滞后或者新加入复制集，那么从节点将会进行重同步，清空本地数据库。至于滞后多少，取决于 Oplog 窗口值的大小。太多的从节点向主节点发送同步请求，导致主节点的访问压力变大，每增加一个从节点会导致主节点存在 10% 的性能影响。主从架构的的读写分离对于可以用于报表业务、历史数据或者日志等场景。如果想提高主节点性能，可以使用 InMemory（企业版） 存储引擎而不是 WT。主节点的写操作如果很频繁，从节点的同步延迟将会变高，但是 MongoDB 是多个线程进行同步的，MySQL 只有一个线程。

**节点间选举是如何完成的？** 具有投票权的节点两两之间互相发送心跳。当没有超过5次心跳时判断节点失联。如果失联的是主节点，那么就要开始选举了。选举基于 RAFT 算法，成功的必要条件是大多数投票节点存活。复制集中最多有50个节点，但是具有投票权的只有7个。

值得注意的是，复制集并没有对数据做分布式存储，只是简单的热备份。Oplog本质上也是一个 ``Collection`` 存储在 ``local`` 数据库中。

**影响选举的因素有哪些呢？** 首先整个集群必须有大多数节点存活，被选举的主节点必须能够与多数节点建立连接，具有较新的 Oplog，具有较高的优先级（如果通过配置文件配置）。

复制集节点有常见以下几个配置：

- ``v`` 参数用于决定是否具有投票权。
- ``priority`` 参数用来配置选举优先级。当值为0的时候无法成为主节点。
- ``hidden`` 参数用来配置复制数据，但是对于应用不可见，隐藏的节点具备投票权但是优先级必须为0。
- ``slaveDelay`` 参数用于复制n秒之前的数据，保持与主节点的时间差，可以用于防止数据误删除。

要启用复制集，只要在配置文件中增加：

```yaml
replication:
    replSetName: 复制集名称
```

当所有节点启动以后，它们还都是独立运行的，通过 MongoDB Shell 连接到一个节点，然后执行配置操作：

```javascript
rs.initiate() // 执行后当前节点会变成从节点，通过 rs.status() 可以看到。
rs.add("主机名:端口")
rs.add("主机名:端口")
```

或者直接提供一个配置文件：

```javascript
rs.initiate({
    _id: "rs0",
    members: [
        {
            _id: 0,
            host: "主机名:端口"
        },
        {
            _id: 2,
            host: "主机名:端口"
        },
        {
            _id: 3,
            host: "主机名:端口"
        }
    ]
})
```

以上这种方式需要 DNS 解析。

对于复制集来说，推荐所有的节点配置都一样，因为任何节点都有可能成为主节点，并且硬件上必须具有独立性。MongoDB 部署复制集的时候软件版本必须一致。对于复制集来说，由于只有主节点承担写请求，那么增加节点不会增加系统的写性能。

默认只能从主节点进行读写，如果从从节点进行读操作，会收到错误提示，通过执行下面的命令允许在从节点读取：

```javascript
rs.slaveOk()
```

对于复制集的配置信息，通过 ``rs.config()`` 可以查看到。

## 分片集

mongos 前面无需任何负载均衡服务，mongos 会自动进行负载均衡。

MongoDB 最多支持 1024 个分片。MongoDB 分片集中的 mongos 是无状态服务，用于转发应用请求，选择合适的节点承担负载，合并多个节点的数据进行返回，建议部署至少2个。
config 服务本质上是一个 MongoDB 复制集，用于存储集群的元数据，比如数据映射关系。MongoDB 的每一个分片都是一个完整的复制集，由于数据分散在不同的分片上，缺少任何一个分片，MongoDB 所提供的数据都是不完整的。

MongoDB 分片集对应用时全透明的，并且数据会自动均衡，动态扩缩容并且无须下线，并且提供了三种分片方式：

- 基于范围：范围查询性能好，但是数据容易不均匀。虽然优化了读取但是可能存在热点数据。
- 基于 Hash：数据分布均匀，针对写进行优化，但是范围查询效率低，适用于物联网、日志等场景。
- 基于 Zone/Tag：通过标签的方式用于全球区域化读取和写入。

设计分片集群的原则：

- 分片大小：尽量将每个分片的数据量控制到 3TB 之内，常用的索引必须能够容纳进内存。
- 分片数量：``max(所需存储总量/单服务器可挂载容量, 工作集大小/单服务器内存容量, 并发量总数/单服务器并发量*0.7)``, MongoDB 会使用 60% 的物理内存来当做缓存。

一些概念：

- 片键：文档中的一个字段。
- 文档：包含片键的一行数据。
- Chunk 块：包含多个文档。
- 分片：包含多个 Chunk 块。
- 集群：包含多个分片。

影响集群的片键效率的主要因素：

- 取值基数
- 取值分布
- 分散写，集中读
- 被尽可能多的业务场景用到
- 避免单调递增或者递减的片键

mongos 与 config 通常消耗很少的资源，可以选择低规格的虚拟机：

- 需要足以容纳热数据索引的内存
- 正确创建索引后 CPU 通常不会成为瓶颈，除非涉及非常多的计算
- 磁盘尽量选用 SSD。

MongoDB 的节点部署都是一样的，只是在启动配置中使用 ``--shardsvr`` 还是 ``configsvr`` 的区别。mongos 启动时要加入 ``--configdb`` 参数，并指定 config 节点的连接地址。
然后连接到 mongos 节点以后添加分片：

```javascript
sh.addShard("shard1/member1.example.com:27010,member2.example.com:27010...");
sh.status();
```

MongoDB 还需要创建分片 Collection 才可以将数据分布在多个分片上：

```javascript
sh.enableSharding("数据库名称");
sh.shardCollection("数据库名称.集合名称", {_id:"hashed"});
sh.status();
```

## 两地三中心

几个概念：

- SLO：服务级别目标，SLO（服务级别目标）是 SLA 中关于特定指标（例如正常运行时间或响应时间）的协议。因此，如果 SLA 是您与客户之间的正式协议，那么 SL​​O 就是您对该客户做出的个人承诺。SLO 设定了客户期望，并告诉 IT 和 DevOps 团队他们需要实现哪些目标并根据这些目标来衡量自己。
- SLI：服务水平指示器，SLI（服务级别指标）衡量对 SLO（服务级别目标）的遵守情况。因此，举例来说，如果您的 SLA 指定您的系统在 99.95% 的时间内可用，那么您的 SLO 可能是 99.95% 的正常运行时间，而您的 SLI 是正常运行时间的实际测量值。也许是99.96%。也许99.99%。为了遵守 SLA，SLI 需要满足或超过该文档中做出的承诺。
- SLA：服务水平协议，是提供商和客户之间关于可衡量指标（例如正常运行时间、响应能力和责任）的协议。 这些协议通常由公司的新业务和法律团队起草，它们代表您对客户做出的承诺，以及如果您未能履行这些承诺的后果。通常，后果包括经济处罚、服务积分或许可证延期。

MTTR 和 MTBF 是常用的衡量 Availability 的指标。常用在 SLA(Service Level Agreements) 中，定量的向用户承诺系统可用性可以达到的标准：

- MTTR：MTTR 应该是从故障发生，到故障修复完成的平均时间，包含了故障发现、定位和修复的时间。对于系统设计者而言，可以从发现、定位、修复这几个方面去优化可用性，但对于用户而言，只关心不可用的时间。
- MTBF：是指系统正常运行的平均时间，MTBF 不包含 MTTR。毕竟系统在故障修复期间无法正常服务。
- RPO：恢复点目标，数据丢失的最长可接受时间。恢复点目标描述了发生灾难时要恢复的数据的寿命。
- RTO：恢复时间目标，可接受的最大停机时间。恢复时间目标本质上是从宣布灾难时（而不是实际事件发生时）到关键流程或系统可供用户使用时恢复所需的时间范围要求。
- MTO：最大可容忍中断目标，关键业务流程的最大可容忍中断表示组织在没有任何形式（手动或自动）的业务流程的情况下可以生存的最长时间。为流程定义 MTO 为您提供了该流程必须以某种形式启动并运行的最后期限。

比如某个数据库实例，每24小时备份一次，有天该数据库所在盘损坏了，需要依据备份重启，重启时间为5分钟。那么该系统的 RTO = 5分钟，RPO = 24小时。

常见的容灾级别如下：

| 级别 | 类型 | RPO | RTO |
| -- | -- | -- | -- |
| L0 | 无备源中心（没有灾难恢复能力，只在本地进行数据备份） | 24小时 | 4小时 |
| L1 | 本地备份 + 异地保存（本地将关键数据备份，然后发送到异地保存。灾难发生后，按照预定数据恢复程序恢复系统和数据。） | 24小时 | 8小时 |
| L2 | 双中心主备模式（在异地建立一个热备份，通过网络进行数据备份。当灾难出现时，备份站点接替主站点，维护业务连续性。） | 秒级 | 数分钟到半小时 |
| L3 | 双中心双活（在相隔较远的地方分别建立两个数据中心，进行相互数据备份。当某个数据中心发生灾难时，另一个数据中心接替其工作任务。） | 秒级 | 秒级 |
| L4 | 双中心双活 + 异地热备 = 两地三中心（在同城分别建立两个数据中心，进行互相数据备份。当该城市的两个中心同时不可用时，快速切换到异地。） | 秒级 | 分钟级 |

两地三中心的架构如下：

![](/article/deep-in-mongodb/high-ab-arch23.svg)

同城节点带宽需要满足低延迟和高速率，异地从节点设置较低的选举优先级。

## 全球多写（MongoDB Zone Sharding）

两地三中心虽然支持异地容灾但是多中心负载均衡仅支持读请求，而且资源利用率不高。全球多写集群支持多中心的负载均衡，提高了用户体验，但是需要数据模型支持。

笔者所在的公司就是采用的全球多写集群。架构如下：

- 针对每个要分片的数据集合，模型中增加一个 zone 字段（与电商系统用户行为分析 spm 字段不同）。
- 给集群的每个分片添加 zone 字段，使用 ``sh.addShardTag("shard0", "USA")``。
- 给每个区域指定属于这个区域的分片块（Chunk）范围，使用 ``sh.addTagRange("", {}, "USA")``。

mongos 将会根据 zone 字段进行数据请求分发。

如果中国用户在本地浏览商品，那么对于事务的要求是 ``readConcern = local`` 并且 ``readPreference = nearest`` 实现了本地读取。
当下单的时候，对于事务的要求是 ``writeConcern = majority`` 实现写到本地节点。
当总部的业务人员查看汇总报表时，那么 ``readPerference = nearest`` 本地读取。
当中国用户去境外旅游时，那么由于 ``writeConcern = majority`` 也可以远程写到中国节点。

![](/article/deep-in-mongodb/global-cluster.svg)

## 最后

MongoDB 上下后需要禁用 NUMA，否则会引起大量的 swap。禁用透明大页，否则会影响数据库效率。开启 ``tcp_keepalive_time`` 为 120 秒，避免一些网络问题。
``ulimit -n`` 设置最大打开文件数，避免句柄数量不足。关闭 atime，提高文件访问效率（``/etc/fstab`` 下配置 ``noatime,nodiratime`` 后重新挂载）。

主从结构的复制集可以通过滚动升级的方式来升级从节点，然后升级完成后在主节点执行 ``rs.StepDown()`` 触发主从切换，当前主节点变成从节点再升级。
升级完后，对于安全升级 MongoDB 3.x 版本以后需要使用 ``db.adminCommand({setFeatureCompatibilityVersion: "版本"})`` 来切换版本。
对于分片集群的升级首先需要禁用 DNS 均衡器，然后升级 config 节点，由于 config 节点本质上就是一个复制集，就可以参考复制集的升级方法。然后升级分片，完成后升级 mongos。

MongoDB 3.6 版本支持自动写重试，可以恢复由于主从切换导致的写失败。MongoDB 4.2 版本支持自动读重试，支持由于主从切换导致的不可读问题。

## SQL 转换

MongoDB 的企业版提供了 MongoDB BI Connector，用于将 SQL 转换为 MongoDB 的执行语句，并且将 MongoDB 返回的 ResultSet 转换为 SQL 所用的返回，但是并不支持写入。

## Ops Manager

MongoDB Ops Manager 是 MongoDB 用 Java 开发的集群管理平台，用于自动化监控 MongoDB，监控和报警，与 Kubernetes 集成，总共100多个指标。

## 监控工具

首先是 ``db.serverStatus()`` 提供了大量的监控信息，然后还有 ``db.isMaster()`` 包含了一些信息，另外 ``mongostats`` 命令行工具也提供了部分信息。
``db.serverStatus()`` 包含的监控信息是从上次开机到现在为止的累计数据，因此不能简单使用。提供了30多个顶级指标，指标下面还有子指标，总共加起来还有数百个指标。

你可以通过为 MongoDB 开发 Prometheus 的 Exporter 来将全部的监控指标传输到 Prometheus 上，并使用 Grafana 进行展示。建议的指标如下：

- ``opcounters``：操作计数，执行的命令的数量统计，通过 ``db.serverStatus().opcounters`` 获取。
- ``tickets``：对 WT 存储引擎的读写令牌数量，令牌数量表示了可以进入存储引擎的并发操作数量。tickets 不足会导致请求排队，不应该去增加 tickets 数量，而是看看什么操作一直耗时。通过 ``db.serverStatus().wiredTiger.concurrentTransactions`` 获取。
- ``replication lag``：复制延迟，这个指标代表了写操作到达从节点所需要的最小时间，过高的值会导致减少节点的价值并不利于配置了 ``writeConcern > 1`` 的数据库读写操作。
- ``oplog window``：复制时间窗，代表 Oplog 可以容纳多长时间的写操作，表示了一个从节点可以离线多长时间仍然可以追上主节点。通常建议 24小时。通过 ``db.oplog.rs.find().sort({$natural: -1}).limit(1).next().ts - db.oplog.rs.find().sort({$natura: 1}).limit(1).next().ts`` 获取。
- ``connections``：连接数，通过 ``db.serverStatus().connections`` 获取。
- ``query targeting``：索引键/文档扫描数量比返回的文档数量，按照秒平均。如果该值较高表示查询需要进行很多低效的扫描来满足查询。这个情况代表了索引不当或者缺少索引来支持查询。
通过 ``var status = db.serverStatus(); status.metrics.queryExecutor.scanned / status.metrics.document.returned`` 和 ``status.metrics.queryExecutor.scannedObjects / status.metrics.document.returned``获取。
- ``scan and order``：每秒内存排序操作所占的平均比例。内存排序十分昂贵，因为要求缓冲大量的数据，如果有合理的索引，那么内存排序是可以避免的。通过 ``var status = db.serverStatus(); status.metrics.operation.scanAndOrder / status.opcounters.query`` 获取。
- ``node status``：节点状态，如果节点状态不是 Primary、Secondary 或者 Arbiter 中的一个，或者无法执行上述命令则报警，通过 ``db.runCommand("isMaster")`` 获取。
- ``data size``：数据大小，每个数据库执行 ``db.stats()`` 获取。
- ``storage size``：磁盘空间大小，已使用的磁盘空间占总空间的百分比。

通过 mongostat 连接到指定的节点可以观察一些数据，mongostat 本身没有什么参数：

```shell
insert query update delete getmore command dirty used flushes vsize  res qrw arw net_in net_out conn set repl                time
    *0    *0     *0     *0       0     1|0  0.0% 0.0%       0 2.79G 134M 0|0 0|0   263b   62.2k    8 rs0  SLV Jun 30 04:04:56.667
    *0    *0     *0     *0       0     0|0  0.0% 0.0%       0 2.79G 134M 0|0 0|0   256b   60.6k    8 rs0  SLV Jun 30 04:04:57.691
    *0    *0     *0     *0       0     1|0  0.0% 0.0%       0 2.79G 134M 0|0 0|0   267b   63.1k    8 rs0  SLV Jun 30 04:04:58.675
```

mongostat 会不断的报告新数据。dirty 和 used 是关键的性能指标，dirty 表示没有刷盘的数据，超过 20% 时就会阻塞新请求。used 表示多少物理内存被使用，超过 95% 会导致阻塞新请求。
``res`` 表示实际的物理内存，``vsize`` 表示虚拟内存。``qrw`` 和 ``arw`` 通常都是较小的数字，如果超过 10 说明请求在排队了。
``conn`` 表示连接数，一般情况下是稳定在某个值而不是不断的增长。

mongotop 也会不断的报告新数据，并且没什么参数，``--json`` 支持输出为 JSON 文件：

```shell
                              ns    total    read    write    2023-06-30T04:10:39Z
               admin.system.keys      0ms     0ms      0ms                        
            admin.system.version      0ms     0ms      0ms                        
        config.clusterParameters      0ms     0ms      0ms                        
 config.external_validation_keys      0ms     0ms      0ms                        
                 config.settings      0ms     0ms      0ms                        
          config.system.sessions      0ms     0ms      0ms                        
    config.tenantMigrationDonors      0ms     0ms      0ms                        
config.tenantMigrationRecipients      0ms     0ms      0ms                        
        config.tenantSplitDonors      0ms     0ms      0ms                        
             config.transactions      0ms     0ms      0ms                        
```

MongoDB Server 产生的日志也需要格外关注。日志会记录执行超过 100ms 的查询和查询计划。

开源的 mtools 也可以用于观察 MongoDB 的日志，``--queries`` 参数可以通过图形化的方式显示慢查询的数量，总结出慢查询的模式和出现的次数等。

## 备份与恢复

MongoDB 的备份机制主要有延迟节点备份和全量备份+Oplog增量备份的方式，其中全量备份有 mongodump 备份、复制数据文件和文件系统快照方式。
节点宕机的问题主要是通过复制集或者分片集来解决，备份主要解决的是有人误删数据库等操作，节点宕机只需要重启即可。

如果要使用复制文件的方式来备份文件，需要先关闭 MongoDB 节点才可以复制，否则复制的文件无效。
如果不想关闭节点，那么可以选择使用 ``db.fsyncLock()`` 锁定节点，完成后执行 ``db.fsyncUnlock()`` 进行解锁。
可以在从节点上完成，这个方式实际上回暂停宕机一个从节点，所以整个过程需要注意投票节点总数。

文件系统快照备份的方式比较简单，但是依赖于文件系统的类型，快照过程中不需要停机。MongoDB 的数据文件和日志文件必须同时在一个存储卷上。
快照完成后应该尽快复制文件并删除快照。

mongodump 备份的速度较慢，但是好在灵活。mongodump 导出的数据不能表示某个时间点，只是某个时间段。
mongodump 备份开始到完成可能消耗很长时间，那么这个备份耗时的时间段中可能数据发生了变化，通常我们是用 mongodump 的时候也会保存备份耗时这段时间的 Oplog。
由于 Oplog 具有幂等性，所有数据不会产生差错。相关参数如下：

- ``--oplog``：mongodump 参数，将差异性 Oplog 备份到一个 bson 文件。
- ``--oplogReplay``：mongorestore 参数，恢复完数据文件后执行 Oplog 重放。通过 ``--oplogFile`` 指定文件位置，通过 ``--oplogLimit`` 指定重放 Oplog 时间点。
- ``--query``：mongodump 参数，支持添加时间范围。

bsondump 命令可以查看导出的 Oplog，找到需要截止的时间点。

对于分片集的备份，较为复杂。虽然与复制集大部分想同，但是有以下细节：

- 应该分别为每个片和 config 备份。
- 分片集备份不仅要考虑一个分片内的一致性问题，还要考虑分片之间的一致性问题，因此每个片要能够恢复到同一个时间点。

分片集的复杂性主要来自两个方面：

- 各个数据节点的时间不一致。
- 分片之间的数据迁移。

因此期间只能停止负载均衡器实现增量备份。停掉均衡以后，备份可以保证每个节点各自是准确的。但是各个节点之间时间点很难保证在同一点上，所以每个节点恢复以后那个状态不是完全同步的。
虽然没有致命风险，但是确实有数据不一致的可能性。如果要做到完全一致，需要使用 MongoDB 企业版 Ops Manager的分片备份功能。

## 安全

### 连接与节点

MongoDB 支持4中安全加固方式：

- 用户名密码
- X.509标准的证书
- LDAP 外部认证（企业版）
- Kerberos 外部认证（企业版）

上面是客户端 SDK 连接到 MongoDB 集群的认证方式。MongoDB 集群中节点的认证方式如下：

- Keyfile：将统一的 Keyfile 文件拷贝到不同节点。Keyfile 的本质就是一个字符串。
- X.509：更加安全，推荐不同的节点使用不同的证书。

当客户端 SDK 连接到 MongoDB 集群后，MongoDB 集群通过角色的方式限制不同的权限。
权限通过 Actions（能做什么）+ Resources（在什么上做）的方式定义 Role。MongoDB 的内置 Role 继承关系图如下：

![](/article/deep-in-mongodb/roles.svg)

用户想要某种权限，可以将其与多个 Role 关联。通过 ``db.createRole()`` 也可以创建自定义 Role。

### 传输与持久化

MongoDB 的数据传输使用 TLS/SSL 的方式进行的。

持久化的加密功能只在企业版中才可以用，主要原理是生成一个 MasterKey 来加密每一个数据库的 Key，然后生成每一个数据库的 Key 来加密每一个数据库。
对于 MasterKey 可以通过文件或者外部密钥管理器来保存。MasterKey 可以加密和解密数据库。

### 审计

MongoDB 企业版支持审计功能，通过 ``--auditDestination syslog`` 的方式将审计日志写入到 syslog，或者 ``--auditDestination file --auditFormat json --auditPath auditLog.json --auditFilter '{atype: {$in: ["createCollection", "dropCollection"]}}'`` 实现将审计日志输出到 JSON 文件。
