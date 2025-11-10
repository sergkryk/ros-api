#!/bin/bash
#
#
#################################
### Created by Pavel Savasin  ###
### Network Solutions, 2016   ###  
### savasin@lanbilling.ru     ###
### Mikrotik PPPoE            ###
#################################
#
# Drop session on mpd by radius CoA
#

# Prerequisites:
# - freeradius-utils 
#   - yum install freeradius-utils
#   - apt-get install freeradius-utils

PARAMS="$*" # all parameters for ./handler from billing
LOG='/var/log/billing/srvctl.log' # no comments

COA_PORT='3799' # port is default
#COA_SECRET='radius_sercret' # coa secret key
COA_SECRET='mikrotik' # coa secret key

RADCLIENT='/usr/bin/radclient -t1 -r1 -c1 -x' # use radius client that support CoA

# flushing variables
ACTION=''
REASON=''
SESSION=''
LOGIN=''
NAS=''
IPLIST=''
SHAPE=''
OLDSHAPE=''
BNGNAME=''
MAC=''
GUEST=''
PASSWORD=''
OLDBLOCKED=''
BLOCKED=''
nIP=''
nNET=''
USERNAME=''
VGLOGIN=''

log()
{
    echo "[`date +'%d-%m-%Y %H:%M:%S'`] (${LOGIN} ${IP}) - $1 -> ${NAS} [$PARAMS]" >> $LOG # log regular events
}

log_error()
{
    echo "[`date +'%d-%m-%Y %H:%M:%S'`] - $1 [$PARAMS]" >> $LOG # log error events
}

# parsing handler parameters
while [ -n "$1" ]
do
    case $1 in
    "--action")
        ACTION=$2
        ;;
    "--reason")
        REASON=$2
        ;;
    "--session")
        SESSION=$2
        ;;
    "--login")
        LOGIN=$2
        ;;
    "--nas")
        NAS=$2
        ;;
    "--ip" | "--net")
        IP=$2
        ;;
    "--shape")
        SHAPE=$2
        ;;
    "--oldshape")
        OLDSHAPE=$2
        ;;
    "--opt-bng-name")
        BNGNAME=$2
        ;;
    "--mac")
        MAC=$2
        ;;
    "--guest")
        GUEST=$2
        ;;
    "--password")
        PASSWORD=$2
        ;;
    "--oldblocked")
        OLDBLOCKED=$2
        ;;
    "--blocked")
        BLOCKED=$2
        ;;
    "--user-name")
        USERNAME=$2
        ;;
    "--vg-login")
        VGLOGIN=$2
        ;;
    *)
        log_error "Unknown parameters: $1, $2"
        ;;
    esac

    shift 2
done

# log_error "DEBUG"

case $ACTION in
    "stop")
        log_error "Action STOP params"
        if [ -z ${SESSION} ]
        then
            log_error "SESSION_ID is not defined"
            exit 1
        fi

        if [ -z ${NAS} ]
        then
            log_error "NAS is not defined"
            exit 1
        fi

        if [ -z ${IP} ]
        then
            log_error "IP is not defined"
            exit 1
        fi

        if [ ${REASON} = 'changed' ]
        then
            if [ -z ${SHAPE} ]
            then
                log_error "SHAPE is not defined"
                exit 1
            fi

            if [ -n ${OLDSHAPE} ]
            then
                log "Changing speed ${OLDSHAPE} => ${SHAPE}"
                echo "User-name=\"${LOGIN}\", 
                      Acct-Session-Id=\"${SESSION}\",
                      Mikrotik-Rate-Limit=\"${SHAPE}k/${SHAPE}k\"" | ${RADCLIENT} ${NAS}:${COA_PORT} coa ${COA_SECRET} >> ${LOG}
            fi
        else
            log "Logging off subscriber => ${REASON}"
                echo "User-name=\"${LOGIN}\", 
                      Acct-Session-Id=\"${SESSION}\"" | ${RADCLIENT} ${NAS}:${COA_PORT} disconnect ${COA_SECRET} >> ${LOG}
        fi
        ;;
    "isg-stop")
        echo "1" > /dev/null
        ;;
    "quota")
        echo "1" > /dev/null
        ;;
    "start")
    log_error "Action START params"
    if [ -z ${SESSION} ]
    then
        log_error "SESSION_ID is not defined"
        exit 1
    fi

    if [ -z ${NAS} ]
    then
        log_error "NAS is not defined"
        exit 1
    fi
    if [ -z ${IP} ]
    then
        log_error "IP is not defined"
        exit 1
    fi
    if [ -z ${SHAPE} ]
    then
        log_error "SHAPE is not defined"
        exit 1
    fi
    log "Set speed => ${SHAPE}"
    echo "User-name=\"${LOGIN}\", 
            Acct-Session-Id=\"${SESSION}\",
            Mikrotik-Rate-Limit=\"${SHAPE}k/${SHAPE}k\"" | ${RADCLIENT} ${NAS}:${COA_PORT} coa ${COA_SECRET} >> ${LOG}   
        ;;
    "edit")
        echo "1" > /dev/null
        ;;
    "off")
        echo "1" > /dev/null
        ;;
    "on")
        echo "1" > /dev/null
        ;;
    "create")
        echo "1" > /dev/null
        ;;
    "delete")
        echo "1" > /dev/null
        ;;
    *)
        log_error "Unknown action $action"
        ;;
esac