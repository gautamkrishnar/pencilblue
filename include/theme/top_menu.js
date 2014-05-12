/**
 * TopMenuService -
 *
 * @author Blake Callens <blake@pencilblue.org>
 * @copyright 2014 PencilBlue, LLC.
 */
function TopMenuService(){}

TopMenuService.getTopMenu = function(session, localizationService, cb) {
    var self = this;
    var dao  = new pb.DAO();
    dao.query('pencilblue_theme_settings').then(function(data) {
        var themeSettings;

        if(util.isError(data) || data.length == 0) {
            themeSettings = {
                site_logo: pb.config.siteRoot + '/img/pb_logo.png',
                carousel_media: []
            };
        }
        else {
            themeSettings = data[0];
        }

        pb.settings.get('section_map', function(err, sectionMap) {
            if (util.isError(err) || sectionMap == null) {
            	sectionMap = [];
            }

            var formattedSections = [];
            dao.query('section').then(function(sections) {
                //TODO handle error
                for(var i = 0; i < sectionMap.length; i++) {
                    var section = self.getSectionData(sectionMap[i].uid, sections);

                    if(sectionMap[i].children.length == 0) {
                        if(section) {
                            //TODO: figure out how to tell if were in one of these sections
                            formattedSections.push(section);
                        }
                    }
                    else {
                        if(section) {
                            section.dropdown = 'dropdown';

                            var sectionHome = pb.utils.clone(section);
                            if(typeof loc !== 'undefined') {

                                sectionHome.name = sectionHome.name + ' ' + localizationService.get('HOME');
                            }
                            delete sectionHome.children;

                            section.children = [sectionHome];

                            for(var j = 0; j < sectionMap[i].children.length; j++) {
                                var child = self.getSectionData(sectionMap[i].children[j].uid, sections);
                                section.children.push(child);
                            }

                            formattedSections.push(section);
                        }
                    }
                }

                pb.content.getSettings(function(err, contentSettings) {
                    var accountButtons = [];

                    if(contentSettings.allow_comments) {
                        if(session && session.authentication && session.authentication.user) {
                            accountButtons = [
                                {
                                    icon: 'user',
                                    href: '/user/manage_account'
                                },
                                {
                                    icon: 'rss',
                                    href: '/feed'
                                },
                                {
                                    icon: 'power-off',
                                    href: '/actions/logout'
                                }
                            ];

                        }
                        else {
                            accountButtons =
                            [
                                {
                                    icon: 'user',
                                    href: '/user/sign_up'
                                },
                                {
                                    icon: 'rss',
                                    href: '/feed'
                                }
                            ];
                        }
                    }

                    cb(themeSettings, formattedSections, accountButtons);
                });
            });
        });
    });
};

TopMenuService.getBootstrapNav = function(navigation, accountButtons, cb)
{
	var ts = new pb.TemplateService();
    ts.load('elements/top_menu/link', function(err, linkTemplate) {
        ts.load('elements/top_menu/dropdown', function(err, dropdownTemplate) {
            ts.load('elements/top_menu/account_button', function(err, accountButtonTemplate) {

            	var bootstrapNav = ' ';
                for(var i = 0; i < navigation.length; i++)
                {
                    if(navigation[i].dropdown)
                    {
                        var subNav = ' ';
                        for(var j = 0; j < navigation[i].children.length; j++)
                        {
                            if(!navigation[i].children[j]) {
                                continue;
                            }

                            var childItem = linkTemplate;
                            childItem = childItem.split('^active^').join((navigation[i].children[j].active) ? 'active' : '');
                            childItem = childItem.split('^url^').join(navigation[i].children[j].url);
                            childItem = childItem.split('^name^').join(navigation[i].children[j].name);

                            subNav = subNav.concat(childItem);
                        }

                        var dropdown = dropdownTemplate;
                        dropdown = dropdown.split('^navigation^').join(subNav);
                        dropdown = dropdown.split('^active^').join((navigation[i].active) ? 'active' : '');
                        dropdown = dropdown.split('^name^').join(navigation[i].name);

                        bootstrapNav = bootstrapNav.concat(dropdown);
                    }
                    else
                    {
                        var linkItem = linkTemplate;
                        linkItem = linkItem.split('^active^').join((navigation[i].active) ? 'active' : '');
                        linkItem = linkItem.split('^url^').join(navigation[i].url);
                        linkItem = linkItem.split('^name^').join(navigation[i].name);

                        bootstrapNav = bootstrapNav.concat(linkItem);
                    }
                }

                var buttons = ' ';
                for(var i = 0; i < accountButtons.length; i++)
                {
                    var button = accountButtonTemplate;
                    button = button.split('^active^').join((accountButtons[i].active) ? 'active' : '');
                    button = button.split('^url^').join(accountButtons[i].href);
                    button = button.split('^icon^').join(accountButtons[i].icon);

                    buttons = buttons.concat(button);
                }

                cb(bootstrapNav, buttons);
            });
        });
    });
};

TopMenuService.getSectionData = function(uid, sections) {
    var self = this;
    for(var i = 0; i < sections.length; i++) {
        if(sections[i]._id.equals(ObjectID(uid))) {
            if (sections[i].url.indexOf('/') === 0) {
        		//do nothing.  This is a hack to get certain things into the
        		//menu until we re-factor how our navigation structure is built.
        	}
        	else if(!pb.utils.isExternalUrl(sections[i].url, self.req))
            {
        	    sections[i].url = pb.utils.urlJoin('/section', sections[i].url);
    	    }
            return sections[i];
        }
    }

    return null;
};

//exports
module.exports = TopMenuService;
