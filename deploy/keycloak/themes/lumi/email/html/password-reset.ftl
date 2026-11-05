<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiResetTitle") fallbackLink=link>
  <p style="margin:0 0 16px;">${msg("lumiResetIntro")}</p>
  <@layout.action link=link label=msg("lumiResetAction") />
  <@layout.expiration />
  <@layout.ignore messageKey="lumiResetIgnore" />
</@layout.emailLayout>
