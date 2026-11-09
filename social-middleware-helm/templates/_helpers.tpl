{{/*
Environments that run the replicated topology: a 3-member MongoDB replica set
(rs0, keyfile auth, custom TLS cert), 3 Redis pods, 2+ social-middleware pods
and PodDisruptionBudgets. Dev runs the same topology as test and prod so that
replica-set behaviour is exercised before it reaches them; dev keeps its own,
much smaller, resource requests (see values.yaml, `*.dev`).

Use for topology only. Resource sizing and the MongoDB backup jobs stay
per-environment and are deliberately not keyed off this.
*/}}
{{- define "sm.replicated" -}}
{{- if or (hasSuffix "-prod" .Release.Namespace) (hasSuffix "-test" .Release.Namespace) (hasSuffix "-dev" .Release.Namespace) -}}
true
{{- end -}}
{{- end -}}

{{/*
Small explicit requests for init containers in dev. Without them the namespace
LimitRange gives each init container 50m CPU, which counts against dev's 500m
request quota and would not leave room for the replicated topology.
*/}}
{{- define "sm.devInitResources" -}}
{{- if hasSuffix "-dev" .Release.Namespace }}
resources:
  {{- toYaml .Values.devInitContainer.resources | nindent 2 }}
{{- end }}
{{- end -}}
