<#ftl output_format="HTML" auto_esc=true>
<#import "template.ftl" as layout>
<@layout.emailLayout title=msg("lumiActionsTitle") fallbackLink=link>
  <p style="margin:0 0 16px;">${msg("lumiActionsIntro")}</p>
  <#if requiredActions?? && requiredActions?has_content>
    <ul style="margin:0 0 16px;padding-left:24px;">
      <#list requiredActions as requiredAction>
        <li>${msg("requiredAction.${requiredAction}")}</li>
      </#list>
    </ul>
  </#if>
  <@layout.action link=link label=msg("lumiActionsAction") />
  <@layout.expiration />
  <@layout.ignore messageKey="lumiActionsIgnore" />
</@layout.emailLayout>
