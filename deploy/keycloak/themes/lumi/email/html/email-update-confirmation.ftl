<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiUpdateEmailTitle") fallbackLink=link>
  <p style="margin:0 0 16px;">${msg("lumiUpdateEmailIntro", newEmail)}</p>
  <@layout.action link=link label=msg("lumiUpdateEmailAction") />
  <@layout.expiration />
  <@layout.ignore messageKey="lumiUpdateEmailIgnore" />
</@layout.emailLayout>
