import type {
	DescribeUserPoolRequest,
	DescribeUserPoolResponse,
	SchemaAttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { config } from "../config";
import { authenticate, keycloakClient } from "../keycloak/client";
import { CognitoException } from "./index";

// Helper to create standard string schema attributes
const stringAttr = (
	name: string,
	opts?: { required?: boolean; mutable?: boolean; min?: string; max?: string },
): SchemaAttributeType => ({
	Name: name,
	AttributeDataType: "String",
	DeveloperOnlyAttribute: false,
	Mutable: opts?.mutable ?? true,
	Required: opts?.required ?? false,
	StringAttributeConstraints: {
		MinLength: opts?.min ?? "0",
		MaxLength: opts?.max ?? "2048",
	},
});

const boolAttr = (name: string): SchemaAttributeType => ({
	Name: name,
	AttributeDataType: "Boolean",
	DeveloperOnlyAttribute: false,
	Mutable: true,
	Required: false,
});

// Standard Cognito user pool schema attributes
const SCHEMA_ATTRIBUTES: SchemaAttributeType[] = [
	stringAttr("sub", { required: true, mutable: false, min: "1" }),
	stringAttr("email", { required: true }),
	boolAttr("email_verified"),
	stringAttr("given_name"),
	stringAttr("family_name"),
	stringAttr("name"),
	stringAttr("middle_name"),
	stringAttr("nickname"),
	stringAttr("preferred_username"),
	stringAttr("profile"),
	stringAttr("picture"),
	stringAttr("website"),
	stringAttr("gender"),
	stringAttr("birthdate", { min: "10", max: "10" }),
	stringAttr("zoneinfo"),
	stringAttr("locale"),
	stringAttr("phone_number"),
	boolAttr("phone_number_verified"),
	stringAttr("address"),
	{
		Name: "updated_at",
		AttributeDataType: "Number",
		DeveloperOnlyAttribute: false,
		Mutable: true,
		Required: false,
		NumberAttributeConstraints: { MinValue: "0" },
	},
	{
		Name: "identities",
		AttributeDataType: "String",
		DeveloperOnlyAttribute: false,
		Mutable: true,
		Required: false,
		StringAttributeConstraints: {},
	},
];

export async function describeUserPool(
	request: DescribeUserPoolRequest,
): Promise<DescribeUserPoolResponse> {
	if (request.UserPoolId !== config.userPool.id) {
		throw new CognitoException(
			"ResourceNotFoundException",
			`User pool ${request.UserPoolId} does not exist.`,
			400,
		);
	}

	await authenticate();
	const userCount = await keycloakClient.users.count();

	return {
		UserPool: {
			Id: config.userPool.id,
			Name: config.userPool.name,
			Policies: {
				PasswordPolicy: {
					MinimumLength: 8,
					RequireUppercase: true,
					RequireLowercase: true,
					RequireNumbers: true,
					RequireSymbols: true,
					TemporaryPasswordValidityDays: 7,
				},
				SignInPolicy: { AllowedFirstAuthFactors: ["PASSWORD"] },
			},
			DeletionProtection: "ACTIVE",
			LambdaConfig: {},
			LastModifiedDate: new Date(),
			CreationDate: new Date(),
			SchemaAttributes: SCHEMA_ATTRIBUTES,
			AutoVerifiedAttributes: ["email"],
			VerificationMessageTemplate: { DefaultEmailOption: "CONFIRM_WITH_CODE" },
			UserAttributeUpdateSettings: {
				AttributesRequireVerificationBeforeUpdate: [],
			},
			MfaConfiguration: "OFF",
			EstimatedNumberOfUsers: userCount,
			EmailConfiguration: { EmailSendingAccount: "COGNITO_DEFAULT" },
			UserPoolTags: {},
			Domain: "local_domain",
			AdminCreateUserConfig: {
				AllowAdminCreateUserOnly: true,
				UnusedAccountValidityDays: 7,
			},
			UsernameConfiguration: { CaseSensitive: false },
			Arn: `arn:aws:cognito-idp:local_region:userpool/${config.userPool.id}`,
			AccountRecoverySetting: {
				RecoveryMechanisms: [
					{ Priority: 1, Name: "verified_email" },
					{ Priority: 2, Name: "verified_phone_number" },
				],
			},
			UserPoolTier: "ESSENTIALS",
		},
	};
}
