---
title: "如何创建一个Prometheus 的 Exporter"
date: 2022-12-09T11:06:59+08:00
draft: false
categories: ["article"]
length: 0
description: "[迁移]使用 Go 为 Prometheus 提供指标样本数据。"
---

本文将通过开发一个 ``helloworld_exporter`` 来演示如何开发 Prometheus Exporter。我们会用到 [https://github.com/prometheus/client_golang](https://github.com/prometheus/client_golang) 库，因此直接安装到项目下即可：

```shell
mkdir helloworld_exporter && cd helloworld_exporter && go mod init github.com/<YourName>/helloworld_exporter
go get -v github.com/prometheus/client_golang
```

我们只需要关注 Promethues 提供的 ``Collector`` 接口即可，这是指标数据采集工作的关键：

```go
type Collector interface {
    Describe(chan<- *Desc)
    Collect(chan<- Metric)
}
```

以上具体的源代码位置在 [https://github.com/prometheus/client_golang/blob/main/prometheus/collector.go](https://github.com/prometheus/client_golang/blob/main/prometheus/collector.go)。

当我们的 exporter 构建完成最主要的是启动一个 HTTP 服务等待 Prometheus Server 作为客户端请求，因此我们创建一个 ``app.go`` 文件：

```go
import (
    "log"
    "net/http"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
    registry := prometheus.NewRegistry()
    http.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{Registry: registry}))
    log.Fatal(http.ListenAndServe("0.0.0.0:9000", nil))
```

对于指标，我们应该创建一个 Collector 结构体来包装各种 Metric：

```go
type HelloCollector struct {
    aMetric *prometheus.Desc
    bMetric *prometheus.Desc
}
```

然后为这个结构体创建一个初始化函数：

```go
func NewHelloCollector() *HelloCollector {
    m := make(map[string]string)
    m["hello"] = "world"

    return &HelloCollector{
        aMetric: prometheus.NewDesc("a", "Display a.", nil, nil),
        bMetric: prometheus.NewDesc("b", "Display b.", []string{"hostname"}, m),
    }
}
```

然后为这个 HelloCollector 实现 Collector 接口的两个方法：

```go
func (collect *fooCollector) Describe(ch chan <- *prometheus.Desc) {
   ch <- collect.aMetric
   ch <- collect.bMetric

}

func (collect *fooCollector) Collect(ch chan<- prometheus.Metric) {
   var metricValue float64

   ch <- prometheus.MustNewConstMetric(collect.aMetric, prometheus.GaugeValue, 1)
   ch <- prometheus.MustNewConstMetric(collect.bMetric, prometheus.CounterValue, 2, "Hi")
}
```

当实现完成之后，就应该注册这个 HelloCollector 了：

```go
helloCollector = NewHelloCollector()
registry.MustRegister(helloCollector)
```

此外，GoDoc 也给出了一个示例：[https://pkg.go.dev/github.com/prometheus/client_golang/prometheus](https://pkg.go.dev/github.com/prometheus/client_golang/prometheus)。
