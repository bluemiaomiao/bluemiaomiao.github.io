---
title: "从 MongoDB Operator 学习"
date: 2023-07-18T14:25:10+08:00
draft: true
categories: ["article"]
length: 0
description: "[更新中] 深度剖析 MongoDB Operator 的设计与实现"
---


在 Kubernetes 中无非就是两种类型的服务：Stateless 和 Stateful 的。对于  Stateless 的应用程序，通常可以很方便的进行垂直或者水平扩缩容。Kubernetes 对 Stateless 的服务使用 Pod 描述，Pod 中包含了 pause 容器和一些 sidecar 应用程序用来处理日志、网络等相关任务。Pod 作为一个独立的调度个体使用 Deployment 实现扩缩容。由于 Pod 只能在当前 Node（主机节点）上访问，所以 Kubernetes 提供了 Service 和 Ingress 实现服务发布和负载均衡。

对于 Stateful 的应用，由于每个服务产生的数据和读取配置信息都不一样，因此每个 StatefulSet 都有一个唯一顺序 ID，并且消耗不同的卷存储资源。

MongoDB 是数据库应用，每个实例读取的配置文件和产生的数据都不一样，因此很容易确定是 Stateful 的应用。运维人员可以通过 StatefulSet 实现 MongoDB 集群的部署，但是 MongoDB 官方也提供了 MongoDB Kubernetes Operator 实现快速部署。

Kubernetes 是可扩展的调度框架，通过 CRD（自定义资源定义）的方式实现扩展，通过原生的 operator-sdk 或者 kubebuilder 结合 client-go 可以完成 Operator 的开发。
