---
title: "Cutting cloud costs on GCP: a simple step-by-step guide"
description: "A systematic approach to finding what actually drives your GCP bill and fixing it — the same method that cut a development environment's costs by more than half."
date: 2023-08-03
tags: [gcp, cloud-costs, bigquery]
canonical: https://medium.com/@lokeshnanda04/cutting-cloud-costs-on-gcp-a-simple-step-by-step-guide-f2d93d57a583
---

In today's tech-driven world, cloud computing has become the backbone of many businesses. However, managing cloud costs can be a daunting task, even with best practices in place. If you find yourself struggling to control your Google Cloud Platform (GCP) bills, fear not!

In this easy-to-understand guide, we'll walk through a systematic approach to optimize your cloud expenses without compromising on performance.

## Identify the cost contributors

Let's begin by understanding where your cloud costs are coming from. Analyze your GCP billing and identify the top cost drivers. By focusing on the major contributors, you can start your cost-saving journey on the right foot.

Log in to your Google Cloud account and search for the billing page. In the right-hand panel you will see the filter: choose the last month's costs and group by **service**. Take out the top 3 contributors in terms of cost. In my case these were BigQuery, Compute Engine and Cloud Storage — this can differ for you depending on your infrastructure usage, but the concept for optimisation remains the same.

## Get deeper insights

Now that you know which services are impacting your bills, it's time to dig deeper. Filter your expenses to reveal the specific aspects of those services that drive up costs. Armed with this knowledge, you can make informed decisions to optimize resource usage.

Under the right panel, set **Group by** to `SKU`, and under the services dropdown select the relevant services — in my case, "BigQuery" and "BigQuery Storage API". This shows what is *really* costing you, so you can target it.

In my case the top contributors were **Active Logical Storage** and **Long Term Storage**. So these needed to be targeted — which means understanding which tables and datasets contribute most to that cost.

## Understand GCP Metrics Explorer

For this, GCP's **Cloud Monitoring → Metrics Explorer** tool can be used. It extracts details about metrics such as data stored and query usage. Since my costs centred on BigQuery storage, I explored the relevant storage metrics.

This process helps you discover the top 10 tables/datasets to target — a focused set that gives maximum impact in your cost-optimization effort. Explore all the available metrics and apply them to your own use case.

> Usage of Metrics Explorer is extremely important for *targeted cost control*.

## Implement targeted optimization

Now that you have insights into where the costs lie, it's time to take action. You have a list of the top 10 tables that are major cost contributors — time to fix them.

Confirm with the data owners whether the data is really needed, then act: set up table partition expiry, or delete the table. Do this step with utmost care, so you don't impact end deliverables.

## Keep it going with best practices

With just basic targeted cleanup in BigQuery, Cloud Storage and Compute Engine, it was possible to bring costs down by **more than 50%** in our development environment.

Cost optimization is an ongoing journey, not a one-time event. The keys to long-term cost reduction:

- Create a culture where resources are used and deleted when no longer needed.
- Continuously monitor billing, with automated GCP alerts when spend exceeds a threshold.
- Set up automated lifecycle rules.
- Spend time in Metrics Explorer to identify and target your pain points.

Hope you found this helpful!
