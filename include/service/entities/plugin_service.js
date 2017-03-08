/*
 Copyright (C) 2016  PencilBlue, LLC

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
'use strict';

//dependencies
const _ = require('lodash');
const ActivePluginService = require('../../../lib/service/plugins/activePluginService');
const ArrayUtils = require('../../../lib/utils/array_utils');
const async   = require('async');
const CacheEntityService = require('../cache_entity_service');
const Configuration = require('../../config');
const DAO = require('../../dao/dao');
const DbEntityService = require('../db_entity_service');
const domain  = require('domain');
const FileUtils = require('../../../lib/utils/fileUtils');
const fs = require('fs');
const log = require('../../utils/logging').newInstance('PluginService');
const MemoryEntityService = require('../memory_entity_service');
const npm = require('npm');
const path = require('path');
const PluginDetailsLoader = require('./plugins/loaders/pluginDetailsLoader');
const PluginRepository = require('../../repository/plugin_repository');
const PluginSettingService = require('./plugin_setting_service');
const PluginUtils = require('../../../lib/utils/pluginUtils');
const PluginValidationService = require('./plugins/plugin_validation_service');
const semver = require('semver');
const SettingServiceFactory = require('../../system/settings');
const SimpleLayeredService = require('../simple_layered_service');
const SiteQueryService = require('./site_query_service');
const SiteService = require('./site_service');
const SiteUtils = require('../../../lib/utils/siteUtils');
const util = require('util');
const ValidationService = require('../../validation/validation_service');

/**
 * PluginService - Provides functions for interacting with plugins.
 * Install/uninstall, setting retrieval, plugin retrieval, etc.
 * @param {Object} options
 * @param {String} [options.site]
 */
class PluginService {
    constructor(options) {
        if (!_.isObject(options)) {
            options = {};
        }

        /**
         * @property site
         * @type {String}
         */
        this.site = options.site || SiteUtils.GLOBAL_SITE;

        //construct settings services
        var caching = Configuration.active.plugins.caching;

        /**
         * A setting service that sets and retrieves the settings for plugins
         * @property pluginSettingsService
         * @type {SimpleLayeredService}
         */
        this.pluginSettingsService = PluginService.genSettingsService('plugin_settings', caching.use_memory, caching.use_cache, 'PluginSettingService', this.site);

        /**
         * A setting service that sets and retrieves the settings for plugins
         * @type {SimpleLayeredService}
         */
        this.themeSettingsService = PluginService.genSettingsService('theme_settings', caching.use_memory, caching.use_cache, 'ThemeSettingService', this.site);
    }

    // Constants
    /**
     * The absolute path to the plugins directory for this PecilBlue installation
     * @type {String}
     */
    static get PLUGINS_DIR() {
        return path.join(Configuration.active.docRoot, 'plugins');
    }

    /**
     * The name of the file that defines the plugin's properties
     * @type {String}
     */
    static get DETAILS_FILE_NAME() {
        return 'details.json';
    }

    /**
     * Retrieves the path to the active fav icon.
     * @method getActiveIcon
     * @param {Function} cb A callback that provides two parameters: cb(Error, URL_PATH_TO_ICON)
     */
    getActiveIcon(cb) {
        var self = this;
        var settings = SettingServiceFactory.getService(Configuration.active.settings.use_memory, Configuration.active.settings.use_cache, this.site);
        settings.get('active_theme', function (err, theme) {
            var active_theme = ActivePluginService.get(theme, self.site);
            cb(err, active_theme && active_theme.icon ? active_theme.icon : '/favicon.ico');
        });
    }

    /**
     * Retrieves a single setting for the specified plugin.
     * @param {string} settingName The name of the setting to retrieve
     * @param {string} pluginName The name of the plugin who owns the setting
     * @param {function} cb A callback that provides two parameters: cb(error, settingValue).
     * Null is returned if the setting does not exist or the specified plugin is not
     * installed.
     */
    getSetting(settingName, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getSetting(settingName, pluginName, cb);
    }

    /**
     * Retrieves all of the settings for the specfied plugin.
     * @param pluginName The name of the plugin who's settings are being requested
     * @param cb A callback that provides two parameters: cb(error, settings).
     * Null is provided in the event that the plugin is not installed.
     */
    getSettings(pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getSettings(pluginName, cb);
    }

    /**
     * Retrieves the settings for a plugin as hash of key/value pairs.  This
     * differs from the getSettings function because the getSettings function
     * provides the settings in their raw form as an array of objects containing
     * multiple properties.  In most circumstances just the k/v pair is needed and
     * not any additional information about the property.  The function takes the
     * raw settings array and transforms it into an object where the setting name
     * is the property and the setting value is the value.
     * @param {String} pluginName The unique ID of the plugin who settings are to be retrieved
     * @param {Function} cb A callback that takes two parameters.  A error, if
     * exists, and a hash of of the plugin's settings' names/values.
     */
    getSettingsKV(pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getSettingsKV(pluginName, cb);
    }

    /**
     * Replaces a single setting for the specified plugin
     * @method setSetting
     * @param name The name of the setting to change
     * @param value The new value for the setting
     * @param pluginName The plugin who's setting is being changed.
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the setting was persisted successfully, FALSE if not.
     */
    setSetting(name, value, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.setSetting(name, value, pluginName, cb);
    }

    /**
     * Replaces the settings for the specified plugin.
     * @method setSettings
     * @param settings The settings object to be validated and persisted
     * @param pluginName The name of the plugin who's settings are being represented
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the settings were persisted successfully, FALSE if not.
     */
    setSettings(settings, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.setSettings(settings, pluginName, cb);
    }

    /**
     * Replaces a single theme setting for the specified plugin
     * @method setThemeSetting
     * @param name The name of the setting to change
     * @param value The new value for the setting
     * @param pluginName The plugin who's setting is being changed.
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the setting was persisted successfully, FALSE if not.
     */
    setThemeSetting(name, value, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.setThemeSetting(name, value, pluginName, cb);
    }

    /**
     * Replaces the theme settings for the specified plugin.
     * @method setThemeSettings
     * @param settings The settings object to be validated and persisted
     * @param pluginName The uid of the plugin who's settings are being represented
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the settings were persisted successfully, FALSE if not.
     */
    setThemeSettings(settings, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.setThemeSettings(settings, pluginName, cb);
    }

    /**
     * Retrieves a single theme setting value.
     * @method getThemeSetting
     * @param settingName The uid of the setting
     * @param pluginName The plugin to retrieve the setting from
     * @param cb A callback that provides two parameters: cb(error, settingValue)
     */
    getThemeSetting(settingName, pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getThemeSetting(settingName, pluginName, cb);
    }

    /**
     * Retrieves the theme settings for the specified plugin
     * @method getThemeSettings
     * @param pluginName The uid of the plugin
     * @param cb A callback that provides two parameters: cb(err, settingsObject)
     */
    getThemeSettings(pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getThemeSettings(pluginName, cb);
    }

    /**
     * Retrieves the theme settings for the specified plugin only for the site set in the current plugin service
     * @method getThemeSettingsBySite
     * @param pluginName
     * @param cb
     */
    getThemeSettingsBySite(pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getThemeSettingsBySite(pluginName, cb);
    }

    /**
     * Retrieves the theme settings for a plugin as hash of key/value pairs.  This
     * differs from the getThemeSettings function because the getThemeSettings function
     * provides the settings in their raw form as an array of objects containing
     * multiple properties.  In most circumstances just the k/v pair is needed and
     * not any additional information about the property.  The function takes the
     * raw settings array and transforms it into an object where the setting name
     * is the property and the setting value is the value.
     * @method getThemeSettingsKV
     * @param {String} pluginName The unique ID of the plugin who settings are to be retrieved
     * @param {Function} cb A callback that takes two parameters.  A error, if
     * exists, and a hash of of the plugin's settings' names/values.
     */
    getThemeSettingsKV(pluginName, cb) {
        var settingService = getPluginSettingService(this);
        settingService.getThemeSettingsKV(pluginName, cb);
    }

    /**
     * Deletes the plugin settings for when plugin uninstalls.
     * @method purgePluginSettings
     * @param {String} pluginUid - the plugin unique id
     * @param {Function} cb - callback function
     */
    purgePluginSettings(pluginUid, cb) {
        var settingService = getPluginSettingService(this);
        settingService.purgePluginSettings(pluginUid, cb);
    }

    /**
     * Deletes the theme settings for when plugin uninstalls.
     * @method purgeThemeSettings
     * @param {String} pluginUid - the plugin unique id
     * @param {Function} cb - callback function
     */
    purgeThemeSettings(pluginUid, cb) {
        var settingService = getPluginSettingService(this);
        settingService.purgeThemeSettings(pluginUid, cb);
    }

    /**
     * Indicates if a plugin by the specified identifier is installed.
     *
     * @method isInstalled
     * @param {string} pluginIdentifier The identifier can either be an ObjectID or the
     * plugin name
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the plugin is installed, FALSE if not.
     */
    isInstalled(pluginIdentifier, cb) {
        this.getPluginBySite(pluginIdentifier, function (err, plugin) {
            cb(err, plugin ? true : false);
        });
    }

    /**
     * Retrieves a plugin descriptor (plugin document)
     *
     * @method getPlugin
     * @param {string} pluginIdentifier The identifier can either be an ObjectID or the
     * plugin name
     * @param {Function} cb A callback that provides two parameters: cb(error, plugin).  If the
     * plugin does exist null is provided.
     */
    getPlugin(pluginIdentifier, cb) {
        PluginRepository.loadPluginAvailableToThisSite(pluginIdentifier, this.site, cb);
    }

    /**
     * @method getPluginBySite
     * @param {string} pluginIdentifier
     * @param {Function} cb
     */
    getPluginBySite(pluginIdentifier, cb) {
        PluginRepository.loadPluginOwnedByThisSite(pluginIdentifier, this.site, cb);
    }

    /**
     * Retrieves the plugins that have themes associated with them
     * @method getPluginsWithThemes
     * @param {Function} cb Provides two parameters: Error, Array
     */
    getPluginsWithThemes(cb) {
        PluginRepository.loadPluginsWithThemesAvailableToThisSite(this.site, cb);
    }

    /**
     * Get plugins that contain a theme on a site level.
     * @method getPluginsWithThemesBySite
     * @param {Function} cb - callback function
     */
    getPluginsWithThemesBySite(cb) {
        PluginRepository.loadPluginsWithThemesOwnedByThisSite(this.site, cb);
    }

    /**
     * Convenience function to generate a service to handle settings for a plugin.
     *
     * @static
     * @method genSettingsService
     * @param objType The type of object that will be dealt with.  (plugin_settings,
     * theme_settings)
     * @param useMemory {Boolean} Indicates if the generated layered service should
     * use an in memory service.
     * @param useCache {Boolean} Indicates if the generated layered service should
     * use a cache service.
     * @param serviceName The name of the service
     * @param {string} site
     * @return {SimpleLayeredService}
     */
    static genSettingsService(objType, useMemory, useCache, serviceName, site) {

        //add in-memory service
        var services = [];

        var options = {
            objType: objType,
            site: site,
            onlyThisSite: false,
            timeout: Configuration.active.plugins.caching.memory_timeout
        };

        if (useMemory) {
            services.push(new MemoryEntityService(options));
        }

        //add cache service
        if (useCache) {
            options.timeout = 3600;
            services.push(new CacheEntityService(options));
        }

        //always add DB
        options.keyField = 'plugin_uid';
        options.valueField = 'settings';
        services.push(new DbEntityService(options));
        return new SimpleLayeredService(services, serviceName);
    }

    /**
     * Compares the details loaded from the plugin config (details.json)
     * with the database values pulled from getSettingsKV(). If a discrepancy
     * is detected, the plugin settings are updated in the database so future
     * calls to getSettingsKV() will have the latest values.
     *
     * @method syncSettings
     * @param plugin {Object} The plugin object
     * @param details {Object} The details object to extract the settings from
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE/FALSE if an error occured.
     */
    syncSettings(plugin, details, cb) {
        var self = this;
        this.getSettings(plugin.uid, function(err, settings) {
            var isError = _.isError(err);
            if (isError || !settings) {
                if (isError) {
                    log.error('Failed to load settings from plugin [%s]', plugin.uid);
                }
                return cb(err, !isError);
            }

            //create lookup
            settings = settings.reduce(function(rv, setting) {
                rv[setting.name] = setting;
                return rv;
            }, {});

            var discrepancy = false;
            var formattedSettings = [];

            // Detect new settings
            details.settings.forEach(function (setting) {
                var settingName = setting.name;
                var val = settings[settingName];
                if (typeof val === 'undefined') {
                    discrepancy = true;
                    val = setting.value;
                    formattedSettings.push({name: settingName, value: val, displayName: setting.displayName, group: setting.group});
                }
                else {
                    if(setting.group !== val.group){
                        val.group = setting.group;
                        discrepancy = true;
                    }
                    else if(settings.displayName !== val.displayName){
                        val.displayName = setting.displayName;
                        discrepancy = true;
                    }
		            formattedSettings.push(val);
                }
            });

            // If there's a size difference, there's a discrepancy
            discrepancy = discrepancy || (details.settings.length !== Object.keys(settings).length);

            // Return if no discrepancy was found
            if (!discrepancy) {
                return cb(null, true);
            }

            self.resetSettings({uid: plugin.uid, settings: formattedSettings}, function (err/*, result*/) {
                if (_.isError(err)) {
                    log.error("PluginService: Failed to save off updated settings for plugin [%s]", plugin.uid);
                }
                cb(err, !_.isError(err));
            });
        });
    }

    /**
     * Loads the settings from a details object and persists them in the DB.  Any
     * existing settings for the plugin are deleted before the new settings are
     * persisted.
     *
     * @method resetSettings
     * @param details The details object to extract the settings from
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the settings were successfully cleared and reloaded. FALSE if not.
     */
    resetSettings(details, cb) {
        var self = this;

        //retrieve plugin to prove it exists (plus we need the id)
        var pluginName = details.uid;
        this.getPlugin(pluginName, function (err, plugin) {
            if (_.isError(err) || !plugin) {
                return cb(err ? err : new Error("The plugin " + pluginName + " is not installed"), false);
            }

            //remove any existing settings
            self.pluginSettingsService.purge(pluginName, function (err, result) {
                if (_.isError(err) || !result) {
                    return cb(err, false);
                }

                //build the object to persist
                var settings = {
                    object_type: 'plugin_settings',
                    plugin_name: plugin.name,
                    plugin_uid: plugin.uid,
                    plugin_id: plugin[DAO.getIdField()].toString(),
                    settings: details.settings
                };

                //save it
                var dao = new SiteQueryService({site: self.site});
                dao.save(settings, function (err/*, result*/) {
                    cb(err, !_.isError(err));
                });
            });
        });
    }

    /**
     * Loads the Theme settings from a details object and persists them in the DB.  Any
     * existing theme settings for the plugin are deleted before the new settings
     * are persisted. If the plugin does not have a theme then false is provided in
     * the callback.
     *
     * @method resetThemeSettings
     * @param details The details object to extract the settings from
     * @param cb A callback that provides two parameters: cb(error, TRUE/FALSE).
     * TRUE if the settings were successfully cleared and reloaded. FALSE if not.
     */
    resetThemeSettings (details, cb) {
        var self = this;

        //error checking
        var pluginName = details.uid;
        if (!details.theme || !details.theme.settings) {
            cb(new Error("PluginService: Settings are required when attempting to reset a plugin's theme settings"), false);
            return;
        }

        //retrieve plugin to prove it exists (plus we need the id)
        this.getPlugin(pluginName, function (err, plugin) {
            if (_.isError(err) || !plugin) {
                cb(err, false);
                return;
            }

            //remove any existing settings
            self.themeSettingsService.purge(pluginName, function (err, result) {
                if (_.isError(err) || !result) {
                    cb(err, false);
                    return;
                }

                //build the object to persist
                var baseDoc = {
                    plugin_name: plugin.name,
                    plugin_uid: plugin.uid,
                    plugin_id: plugin[DAO.getIdField()].toString(),
                    settings: details.theme.settings
                };
                var settings = baseDoc;
                settings.object_type = 'theme_settings';

                //save it
                var dao = new SiteQueryService({site: self.site});
                dao.save(settings, function (err/*, result*/) {
                    cb(err, !_.isError(err));
                });
            });
        });
    }

    /**
     * Retrieves the available plugins.  An available plugin is one who is
     * uninstalled but available to be installed.
     * @method getAvailablePlugins
     * @param {Array} active An array of plugin detail objects.  Each object is
     * required to have a uid property that is a string.
     * @param {Array} inactive An array of plugin details objects. Each object is
     * required to have a uid property that is a string.
     * @param {Function} cb A callback that provides two parameters: cb(Error, Array)
     */
    getAvailablePlugins(active, inactive, cb) {
        if (Array.isArray(active)) {
            active = ArrayUtils.toObject(active, function(val) {
                return val ? val.uid : '';
            });
        }
        if (Array.isArray(inactive)) {
            inactive = ArrayUtils.toObject(inactive, function(val) {
                return val ? val.uid : '';
            });
        }

        FileUtils.getDirectories(PluginUtils.PLUGINS_DIR).catch(cb).then(function (directories) {

            var plugins = [];
            var tasks = directories.map(function (directory, i, directories) {
                return function (callback) {

                    //skip pencilblue
                    var parts = directories[i].split(path.sep);
                    var dirName = parts[parts.length - 1];
                    if (dirName === Configuration.active.plugins.default) {
                        callback(null, true);
                        return;
                    }

                    var detailsFilePath = path.join(directories[i], PluginService.DETAILS_FILE_NAME);
                    var details = PluginDetailsLoader.loadByPath(detailsFilePath);
                    if (!details) {
                        plugins.push({
                            uid: dirName,
                            dirName: dirName,
                            description: "Failed to load & parse the details.json file.",
                            validationErrors: ['An invalid details file was provided for plugin. ']
                        });
                        return callback(null, false);
                    }

                    PluginValidationService.validateToError(details, function (err/*, result*/) {
                        if (_.isError(err)) {
                            plugins.push({
                                uid: dirName,
                                dirName: dirName,
                                version: details.version,
                                description: "The plugin details file failed validation ",
                                validationErrors: err.validationErrors
                            });
                            return callback(null, false);
                        }
                        else if ((active && active[details.uid]) || (inactive && inactive[details.uid])) {
                            return callback(null, true);
                        }
                        details.dirName = dirName;
                        plugins.push(details);
                        callback(null, true);
                    });
                };
            });
            async.series(tasks, function (err/*, results*/) {
                cb(err, plugins);
            });
        });
    }

    /**
     * Retrieves a map of the system's plugin.  The map provides three properties:
     * active, inactive, available.
     * @method getPluginMap
     * @param {Function} cb A callback that provides two parameters: cb(Error, Object)
     */
    getPluginMap(cb) {
        var self = this;
        var tasks = {

            active: function (callback) {
                PluginRepository.loadIncludedPluginsOwnedByThisSite(ActivePluginService.getPluginNames(), self.site, callback);
            },

            inactive: function (callback) {
                PluginRepository.loadPluginsNotIncludedOwnedByThisSite(ActivePluginService.getPluginNames(), self.site, cb);
            }
        };
        async.series(tasks, function (err, results) {
            if (_.isError(err)) {
                cb(err, results);
                return;
            }

            self.getAvailablePlugins(results.active, results.inactive, function (err, available) {
                results.available = available;
                cb(err, results);
            });
        });
    }

    /**
     * TODO [1.0] remove
     * Retrieves a plugin service prototype.  It is expected to be a prototype but
     * it may also be an instance as along as that instance fulfills all
     * responsibilities of the service interface.  When the desired service does not
     * exist NULL is returned.
     * @deprecated
     * @param {String} serviceName
     * @param {String} pluginUid The unique plugin identifier
     * @param {string} [site=global] - The site UID
     * @return {Object} Service prototype
     */
    static getService(serviceName, pluginUid, site) {
        return ActivePluginService.getService(serviceName, pluginUid, site);
    }

    /**
     * Attempts to require the main module file for a plugin.
     * @deprecated
     * @param {String} pluginDirName The name of the directory that the plugin is
     * contained within.
     * @param {String} pathToModule The name of the main module file.  It is also
     * to pass this parameter as the absolute file path to the module.  The
     * function first checks if the parameter is just the file name then checks to
     * see if it is an absolute path.
     * @return {Function} The main-module prototype
     */
    static loadMainModule(pluginDirName, pathToModule) {
        var pluginMM = path.join(PluginService.PLUGINS_DIR, pluginDirName, pathToModule);
        var paths = [pluginMM, pathToModule];

        var mainModule = null;
        for (var i = 0; i < paths.length; i++) {
            try {
                mainModule = require(paths[i]);
                break;
            }
            catch (e) {
                if (log.isDebug()) {
                    log.warn('PluginService: Failed to load main module at %s: %s', paths[i], e.stack);
                }
            }
        }
        return mainModule;
    }

    /**
     * Constructs the path to a specific plugin's details.json file
     * @static
     * @method getDetailsPath
     * @param {String} pluginDirName The name of the directory that the plugin is
     * contained within.
     * @return {string} The absolute file path to the details.json file for a plugin
     */
    static getDetailsPath(pluginDirName) {
        return path.join(PluginService.PLUGINS_DIR, pluginDirName, PluginService.DETAILS_FILE_NAME);
    }

    /**
     * Attempts to load and parse the details.json file for a plugin.
     * @deprecated
     * @param {String} filePath The absolute path to the details.json file
     * @param {Function} cb A callback that provides two parameters: cb(error, detailsObject)
     */
    static loadDetailsFile(filePath, cb) {
        fs.readFile(filePath, function (err, data) {
            if (_.isError(err)) {
                cb(err, null);
                return;
            }

            //attempt to parse the json
            try {
                cb(null, JSON.parse(data));
            }
            catch (e) {
                e.message = "Failed to parse json file [" + filePath + ']. ' + e.message;
                e.code = 500;
                e.source = e;
                cb(e, null);
            }
        });
    }

    /**
     * TODO [1.0] make each job responsible for callback registration
     * TODO [1.0] remove
     * @static
     * @method init
     */
    static init() {

        //register for commands
        //var commandService = CommandService.getInstance();
        //commandService.registerForType(PluginUninstallJob.UNINSTALL_PLUGIN_COMMAND, PluginService.onUninstallPluginCommandReceived);
        //commandService.registerForType('is_plugin_available', PluginService.onIsPluginAvailableCommandReceived);
        //commandService.registerForType('install_plugin_dependencies', PluginService.onInstallPluginDependenciesCommandReceived);
        //commandService.registerForType('initialize_plugin', PluginService.onInitializePluginCommandReceived);
    }
}

function getPluginSettingService(self) {
    if(!self.pluginSettingService) {
        self.pluginSettingService = new PluginSettingService({ pluginService: self });
    }
    return self.pluginSettingService;
}

//exports
module.exports = PluginService;
