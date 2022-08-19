import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  REST,
  SelectMenuBuilder,
  SelectMenuComponentOptionData,
  SelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { assertAdmin } from "./permissions";

import { DiscordServer } from "../../db/entity/DiscordServer";
import { DiscordServerRepository } from "../../db";
import { getRoles, isBotRole } from "../role";
import starkcordModules from "../../starkcordModules";

type OngoingConfiguration = {
  network?: string;
  roleId?: string;
  moduleType?: string;
  moduleConfig?: any;
};

type OngoingConfigurationsCache = {
  [guildId: string]: OngoingConfiguration;
};

const ongoingConfigurationsCache: OngoingConfigurationsCache = {};

export const handleInitialConfigCommand = async (
  interaction: ChatInputCommandInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  ongoingConfigurationsCache[interaction.guildId] = {};

  const roles = await getRoles(restClient, interaction.guildId);
  // Showing roles, excluding everyone and the bot's role
  const options = roles
    .filter((role) => role.name !== "@everyone" && !isBotRole(role))
    .map((role) => ({
      label: role.name,
      value: role.id,
    }));

  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starkcord-config-role")
      .setPlaceholder("Role to assign")
      .addOptions(...options)
  );
  await interaction.reply({
    content:
      "What role do you want to assign to people matching your criteria?",
    components: [row],
    ephemeral: true,
  });
};

export const handleRoleConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  const roles = await getRoles(restClient, interaction.guildId);
  const botRole = roles.find((role) => isBotRole(role));
  const selectedRole = roles.find((role) => role.id === interaction.values[0]);

  if (!botRole || !selectedRole) return;
  // Bot role position must be bigger (= higher on the list) than the selected role so we can assign
  if (botRole.position <= selectedRole.position) {
    await interaction.update({
      content: `❌ You have selected a role that the bot cannot control. Please place the role \`${botRole.name}\` above the role \`${selectedRole.name}\` in Server Settings > Roles`,
      components: [],
    });
    return;
  }

  ongoingConfigurationsCache[interaction.guildId].roleId =
    interaction.values[0];
  await interaction.update({
    content: "Thanks, following up...",
    components: [],
  });

  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starkcord-config-network")
      .setPlaceholder("Starknet Network")
      .addOptions(
        {
          label: "Goerli",
          description: "The Goerli Starknet testnet",
          value: "goerli",
        },
        {
          label: "Mainnet",
          description: "The Starknet mainnet",
          value: "mainnet",
        }
      )
  );

  await interaction.followUp({
    content: "On what Starknet network do you want to set up Starkcord?",
    components: [row],
    ephemeral: true,
  });
};

export const handleNetworkConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  ongoingConfigurationsCache[interaction.guildId].network =
    interaction.values[0];
  await interaction.update({
    content: "Thanks, following up...",
    components: [],
  });

  const modulesOptions: SelectMenuComponentOptionData[] = [];
  for (const starkcordModuleId in starkcordModules) {
    const starkcordModule = starkcordModules[starkcordModuleId];
    modulesOptions.push({
      label: starkcordModule.name,
      value: starkcordModuleId,
    });
  }

  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starkcord-config-module-type")
      .setPlaceholder("Starkcord module to use")
      .addOptions(...modulesOptions)
  );
  await interaction.followUp({
    content: "What Starkcord module do you want to use (only ERC-721 for now)?",
    components: [row],
    ephemeral: true,
  });
};

export const handleModuleTypeConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  const starkcordModuleId = interaction.values[0];
  ongoingConfigurationsCache[interaction.guildId].moduleType =
    starkcordModuleId;
  const starkcordModule = starkcordModules[starkcordModuleId];
  if (!starkcordModule) return;

  const modal = new ModalBuilder()
    .setCustomId("starkcord-config-module-config")
    .setTitle(`Configure the ${starkcordModule.name} Starkcord module`);
  const rows = starkcordModule.fields.map((moduleField) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(moduleField.id)
        .setLabel(moduleField.question)
        .setStyle(
          moduleField.textarea ? TextInputStyle.Paragraph : TextInputStyle.Short
        )
    )
  );
  modal.addComponents(...rows);
  await interaction.showModal(modal);
  await interaction.editReply({
    content: "Thanks, following up...",
    components: [],
  });
};

export const handleModuleConfigCommand = async (
  interaction: ModalSubmitInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  const moduleConfig: any = {};
  interaction.fields.fields.forEach(
    (fieldValue) => (moduleConfig[fieldValue.customId] = fieldValue.value)
  );

  const currentConfig = ongoingConfigurationsCache[interaction.guildId];
  currentConfig.moduleConfig = moduleConfig;
  const role = (await getRoles(restClient, interaction.guildId)).find(
    (r) => r.id === currentConfig.roleId
  );

  let summaryContent = `Thanks for configuring Starkcord 🎉\n\nHere is a summary of your configuration:\n\n__Starknet network:__ \`${currentConfig.network}\`\n__Discord role to assign:__ \`${role?.name}\`\n__Starkcord module:__ \`${currentConfig.moduleType}\`\n\nModule specific settings:\n`;
  for (const fieldId in moduleConfig) {
    summaryContent = `${summaryContent}\n${fieldId}: \`${moduleConfig[fieldId]}\``;
  }
  summaryContent = `${summaryContent}\n\n**Do you want to save this configuration?**`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("starcord-config-cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("starcord-config-confirm")
      .setLabel("Save configuration")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({
    content: summaryContent,
    components: [row],
    ephemeral: true,
  });
};

export const handleConfigCancelCommand = async (
  interaction: ButtonInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  delete ongoingConfigurationsCache[interaction.guildId];

  await interaction.update({
    content: "❌ Starkcord configuration aborted.",
    components: [],
  });
};

export const handleConfigConfirmCommand = async (
  interaction: ButtonInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  const currentConfig = ongoingConfigurationsCache[interaction.guildId];

  const alreadyDiscordServer = await DiscordServerRepository.findOneBy({
    id: interaction.guildId,
  });

  const discordServer = alreadyDiscordServer || new DiscordServer();
  discordServer.id = interaction.guildId;
  if (
    currentConfig.network !== "mainnet" &&
    currentConfig.network !== "goerli"
  ) {
    throw new Error("Wrong network config");
  }
  discordServer.starknetNetwork = currentConfig.network;
  if (!currentConfig.roleId) {
    throw new Error("Wrong role config");
  }
  discordServer.discordRoleId = currentConfig.roleId;
  if (currentConfig.moduleType !== "erc721") {
    throw new Error("Wrong module config");
  }
  discordServer.starkcordModuleType = currentConfig.moduleType;

  discordServer.starkcordModuleConfig = currentConfig.moduleConfig;

  await DiscordServerRepository.save(discordServer);

  delete ongoingConfigurationsCache[interaction.guildId];

  await interaction.update({
    content: "✅ Thanks, your Starkcord configuration is now done.",
    components: [],
  });
};