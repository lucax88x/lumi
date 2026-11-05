<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiVerifyTitle") fallbackLink=link>
  <p style="margin:0 0 16px;">${msg("lumiVerifyIntro")}</p>
  <@layout.action link=link label=msg("lumiVerifyAction") />
  <@layout.expiration />
  <@layout.ignore messageKey="lumiVerifyIgnore" />
</@layout.emailLayout>
