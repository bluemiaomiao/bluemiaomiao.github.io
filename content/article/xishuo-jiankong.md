---
title: "细说监控"
date: 2023-06-18T00:31:04+08:00
draft: true
categories: ["article"]
length: 0
description: "[迁移]关于 Zabbix 与 Prometheus 和运维和二次开发"
---

说起监控，Zabbix 和 Prometheus 都是常用的监控系统，主要思路是使用 Agent 或者客户端自动上报的方式通过网络传递监控数据，然后由监控系统存储后进行可视化。
Zabbix 是老牌的监控系统，已经成功实现了商业化。Prometheus 是基于 TSDB（时序数据库）构建的面向云原生的监控系统。
下面我们来详细讲解 Zabbix 和 Promethues 的架构、运维和二次开发。

# Zabbix

Zabbix 采用了 Server + Agent 的方式来构建监控系统，并且在系统内提供了一个概念，常见的比如 ``Host``、``Host Group``、``Item`` 等。更多的概念可以查看 Zabbix 关于定义的文档：[https://www.zabbix.com/documentation/current/zh/manual/definitions](https://www.zabbix.com/documentation/current/zh/manual/definitions)，如果你是监控系统的负责人，那么 Zabbix 也可以通过二次开发的方式更加贴近现有业务。

## 架构

一个典型的监控告警触发过程是这样的：由客户端或者 Agent 读取到日志条目（Item），然后推送到服务端（Server），服务端将这个日志数据定义为一个触发器（Trigger），触发器触发某种动作（Action），通过媒介（Media）传送通知（Notification）。一个典型的 Zabbix 架构如下：

![](/article/xishuo-jiankong/zabbix-archs.svg)

各个组件的功能如下：

- Dashboard：用于操作和展示的界面，连接到 Zabbix Server，通过 JSON RPC 的方式传输数据。
- Server：Zabbix 的服务器端，可以配置不同的数据库作为存储，例如 MySQL、PostgreSQL 等，可以直接接受来自 Agent 或者 Sender 的监控数据，也可以接受 Proxy 的监控数据。
- Proxy：为了缓解 Zabbix Server 的压力而构建的中转站，是可选的部署项。
- Java Gateway：运行在被监控目标上的一个守护进程，用来读取 JMX 数据。
- Sender：用户可以自定义监控数据读取方式，然后由 Sender 发送至 Proxy 或者 Server，通常是一个脚本。
- Agent：分为 1.0 版本和 2.0 版本，1.0 版本使用 C 语言开发，尽量的使用了本地系统调用，因此性能比较高，可以实现主动（在 Server 加载计算规则，由 Agent 计算后传输到 Server）和被动检查。2.0 版本使用 Go 开发，性能更高，但是仅支持 Windows 和 Linux。支持自动发现，注册到 Server。
- Get：是一个命令行程序，用于安装到被监控目标机器上，从 Agent 获取数据并显示到终端。
- Web Service：是一个用来连接外部网站服务的进程，收集和发送定时报告，并且计划未来添加更多功能。

## API

Zabbix API 允许你以编程方式检索和修改 Zabbix 的配置，并提供对历史数据的访问：

- 创建新的应用程序以使用Zabbix；
- 将Zabbix与第三方软件集成；
- 自动执行常规任务。

Zabbix API 是基于 Web 的API，作为 Web 前端的一部分提供。它使用 JSON-RPC 2.0 协议，这意味着两点：

- 该 API 包含一组独立的方法；
- 客户端和 API 之间的请求和响应使用 JSON 格式进行编码。

当完成了前端的安装配置后，你就可以使用远程HTTP请求来调用API。

上面都是来自 Zabbix 文档的拷贝，笔者提示：API 都是向后兼容的，并且文档也提示我们：为了简化API版本控制，自 Zabbix 2.0.4 开始，API 的版本与 Zabbix 本身的版本相匹配。你可以使用 ``apiinfo.version`` 方法查找你正在使用的 API 的版本。 这对于调整应用程序以使用特定于版本的功能非常有用。

Zabbix 的 API 需要登录后通过认证后才可以使用，有认证两种方式：

- 在 HTTP/HTTPS Header 中的 Authorization 字段。
- ``application/json-rpc`` 请求中的 ``auth`` 字段。

至于登录，直接使用用户名和密码登录即可。

Zabbix API 的开发文档在这里：[https://www.zabbix.com/documentation/current/zh/manual/api/reference](https://www.zabbix.com/documentation/current/zh/manual/api/reference)

# Prometheus

Prometheus 可以说是目前最火爆的监控系统项目了，官方网站映入眼帘的 “From metrics to insight” 也是很抽象很高级，意味着监控的方式从传统 All in one 方式转变为插件化，从可视化转变为 DSL 化。
现代应用的业务复杂度和数据规模直接决定了软件工程和硬件工程的复杂性。

配置文件不再是简单的 ``ini``、``properties`` 格式了，从支持嵌套的 XML 开始就走上了逐渐 DSL 化的不归路。
先是 YAML 配置语言的出现，再到 Python Script、Lua Script、TypeScript 的盛行，处处透露着配置文件逐渐演变成一门带有逻辑性脚本语言，就算是 NGINX 的 ``conf`` 文件也是有上下文的，如果你阅读 NGINX 针对配置文件解析器的实现的时候就会发现如此。

Prometheus 将监控数据定义为时间序列日志，使用 TSDB 存储，并且提供了 PromQL 查询语言，将只有在大型企业应用软件上才有的 DSL 功能迁移到了监控系统。本文将详细介绍 Promethues 各个组件的功能，并在一篇新的文章讲解 [《如何开发一个 Prometheus Exporter》](/article/how-to-create-a-prometheus-exporter)。

## 架构

Promethues 是100%开源和社区驱动的，在云原生计算基金会毕业，所有组件都可以在 GitHub 上的 Apache 2 许可证下获得。

![](/article/xishuo-jiankong/prometheus-archs.svg)

在该架构图中，Exporter 或者是应用程序通过网络向 HTTP Server 或者 Push Gateway 传递数据，然后持久化到 TSDB 中。前端的组件例如 API 客户端或者 Grafana 这种可视化面板通过创建 PromQL 查询请求发送到 HTTP Server，然后 HTTP Server 在 TSDB 中读取数据并计算后返回。当 HTTP Server 发现触发某种告警，那么将告警信息推送到 Alert Manager，进一步通过 WebHook 或者邮件的方式发送给需要的人。

Prometheus 支持联邦集群，允许 Prometheus 服务器从另一个 Prometheus 服务器抓取选定的时间序列，官网推荐的联邦方式有：分层联邦和跨服务联邦。

- 分层联邦：允许 Prometheus 扩展到具有数十个数据中心和数百万个节点的环境。拓扑类似于树，较高级别的 Prometheus 服务器从大量从属服务器收集聚合时间序列数据。
- 跨服务联邦：在跨服务联合中，一个 Prometheus 服务器被配置为从另一个 Prometheus 服务器中抓取选定的数据，以便针对单个服务器内的两个数据集启用警报和查询。

联邦用到的 API 端点是：``/federate``。

Prometheus 将监控数据定义为时间序列数据，每一条监控数据都会有一个时间戳。其数据模型中包含两个概念：指标名称/标签和采样数据。

- 指标名称/标签: 每一个时间序列数据都由一个唯一的名称和可选的键值对构成，例如：``http_requests_total``。
- 采样数据：应该包含 float64 类型的值作为当前时间戳下的监控数据，并且还要包含一个毫秒级别的时间戳。

时间序列数据采用下面的格式：

```shell
<metric name>{<label name>=<label value>, ...}
```

这与OpenTSDB使用的表示法相同。

指标数据的类型分为4种：

- Counter：计数器，是一个单调递增的值，这个值只能在重启或者重置时导致回滚成为0，不要使用 Counter 处理可能减少的值。
- Gauge：表示单个数值的指标，可增可减，比如温度、内存压力、CPU 繁忙程度等。
- Histogram：直方图，对指标的范围性（区间）统计。对观察结果（通常是请求持续时间或响应大小）进行采样，并在可配置的桶中对其进行计数，它还提供了所有观测值的总和。
- Summary：与直方图类似，摘要对观察结果（通常是请求持续时间和响应大小）进行采样。虽然它还提供了观测的总数和所有观测值的总和，但它计算了滑动时间窗口上的可配置分位数。

Histogram 与 Summary 的不同在于 Histogram 的客户端性能只需要增加 Counter，代价小一些。而 Summary 比较消耗客户端性能，需要流式计算。但是 Histogram 的服务端由于需要计算分位数，因此可能会耗时。
Histogram 的误差与 Bucket 的大小有关，Summary 的误差与 fai 的配置有关。

## 存储指标数据

Prometheus 使用 TSDB 存储指标数据。GitHub 上的存储库展示了 TSDB 的设计：[https://github.com/prometheus/prometheus/tree/main/tsdb](https://github.com/prometheus/prometheus/tree/main/tsdb)。笔者后面的文章将会详细讲解 TSDB 的设计。

### 分段存储

Prometheus 的 TSDB 以自定义的高效格式将数据存储在本地存储上。样本数据被分成两小时的区块。每个两小时块由一个目录组成，该目录包含一个 ``chunks`` 子目录，其中包含该时间窗口的所有时间序列样本、一个元数据文件（``meta.json``）和一个索引文件（``index``，该文件将指标名称和标签索引到 ``chunks`` 目录中的时间序列）。``chunks`` 目录中的样本默认分组为一个或多个段文件，每个段文件最大为 512MB。

 Prometheus 的本地存储不支持不符合 POSIX 标准的文件系统，因为可能会发生不可恢复的损坏。不支持 NFS 文件系统（包括 AWS 的 EFS）。NFS 可能符合 POSIX 标准，但大多数实现并非如此。为了可靠性，强烈建议使用本地文件系统。

### 惰性删除

当通过 API 删除数据时，删除记录存储在单独的逻辑删除文件中（而不是立即从块段中删除数据）。过期块清理在后台进行。删除过期的块最多可能需要两个小时。块必须完全过期才能被删除。

Prometheus Server 提供的启动参数 ``--storage.tsdb.retention.time`` 可以设置删除多久的数据，默认是 ``15d``，即15天。

Prometheus 每个样本平均仅存储 1-2 个字节。因此，要规划 Prometheus 服务器的容量，可以使用粗略的公式：``所需磁盘容量 = 保持时间（秒） * 每秒读取的样本数据 * 每个样本的字节数``。

### WAL 日志

当前样本的块保留在内存中，并且不完全保留。它通过预写日志 (WAL) 来防止崩溃，该日志可以在 Prometheus 服务器重新启动时重播。预写日志文件以 128MB 段存储在 ``wal`` 目录中。这些文件包含尚未压缩的原始数据；因此它们比常规块文件大得多。Prometheus 将保留至少三个预写日志文件。

高流量的服务器可能会保留三个以上的 WAL 文件，以便保留至少两个小时的原始数据。

### 压缩

最初的两小时块最终在后台被压缩为更长的块。压缩将创建更大的块，其中包含最多保留时间 10% 或 31 天（以较小者为准）的数据。

Prometheus 支持将 OpenMetrics 格式的数据回填到 TSDB 中，使用 promtool 即可，但是不要回填最近3小时的数据，可能发生冲突。

## 开发 exporter 的最佳实践

通常，我们会通过开发一个 exporter 来实现向 Prometheus 推送监控指标数据。接下来我们将使用 Go 语言开发一个 Hello World 级别的 exporter。
对于 exporter 的开发，官方网站给出了一些准则：

- 昂贵的指标应该禁用。一般情况下 exporter 应该是一个守护进程，通过传递 ``--enable-xxx`` 的方式来启用昂贵的指标。
- 开箱即用。开发者应该确保 exporter 足够的开箱即用，而不是读取一个 YAML 配置。
- 配置使用 YAML 文件。exporter 即便需要读取配置文件，格式也应该是 YAML 格式的。
- 指标名称的命令使用 ``snake_case``。
- 指标值应该使用基本单位。例如秒，字节等。
- 见名知义。使用 ``http_request_total`` 而不是 ``request_total``。
- 应用程序的指标名称通常应以 exporter 的名称为前缀。
- 公开的指标不应包含冒号，这些是为用户定义的记录规则保留的，以便在聚合时使用。
- ``_sum``、``_total``、``_count``、``_bucket``。这些后缀用于 Counter、Histogram 和 Summary。
- ``process_`` 和 ``scrape_`` 被保留。
- 避免 ``type`` 作为标签名称，它太通用而且通常毫无意义。
- 避免使用 ``le`` 和 ``quantile``。前者用于 Histogram，后者用于 Summary。
- 读/写和发送/接收最好作为单独的指标，而不是作为标签。
- 如果发现想要对所有指标应用相同的标签，请停止。
- 类型匹配。应该尝试将指标类型与 Prometheus 类型相匹配。
- 每个实例一个。每个导出器应该只监视一个实例应用程序，最好位于同一台计算机上的该实例应用程序旁边。
- 不需要时间戳。仅当 Prometheus 抓取指标时才应从应用程序中提取指标，exporter 不应根据自己的计时器执行抓取。也就是说，所有的抓取应该是同步的。
- 抓取失败应该使用 5xx 状态码或者在 ``xxx_up`` 返回0或者1。
- 如果 exporter 需要一个页面，应该包含 exporter 的名称和页面链接。并且，应该有个链接指向 ``/metrics`` 页面。
- 应该固定端口号。并且可以通过 ``--port`` 指定用户自定义的端口号。
