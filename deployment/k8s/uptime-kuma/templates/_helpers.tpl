{{/*
Expand the name of the chart.
*/}}
{{- define "uptime-kuma.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "uptime-kuma.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "uptime-kuma.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "uptime-kuma.labels" -}}
helm.sh/chart: {{ include "uptime-kuma.chart" . }}
{{ include "uptime-kuma.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "uptime-kuma.selectorLabels" -}}
app.kubernetes.io/name: {{ include "uptime-kuma.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "uptime-kuma.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "uptime-kuma.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
OpenResty labels
*/}}
{{- define "uptime-kuma.openresty.labels" -}}
helm.sh/chart: {{ include "uptime-kuma.chart" . }}
{{ include "uptime-kuma.openresty.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
OpenResty selector labels
*/}}
{{- define "uptime-kuma.openresty.selectorLabels" -}}
app.kubernetes.io/name: {{ include "uptime-kuma.name" . }}-openresty
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: load-balancer
{{- end }}

{{/*
MariaDB labels
*/}}
{{- define "uptime-kuma.mariadb.labels" -}}
helm.sh/chart: {{ include "uptime-kuma.chart" . }}
{{ include "uptime-kuma.mariadb.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
MariaDB selector labels
*/}}
{{- define "uptime-kuma.mariadb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "uptime-kuma.name" . }}-mariadb
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: database
{{- end }}

{{/*
Namespace
*/}}
{{- define "uptime-kuma.namespace" -}}
{{- default .Release.Namespace .Values.global.namespace }}
{{- end }}
